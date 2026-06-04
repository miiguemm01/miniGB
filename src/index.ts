import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { dirname } from "path";
import { CPU, CpuStateSnapshot } from "./hardware/cpu";
import { JoypadButton, Memory, MemoryStateSnapshot } from "./hardware/memory";
import {
    LCD_HEIGHT,
    LCD_WIDTH,
    TILESET_HEIGHT,
    TILESET_WIDTH,
    VideoRenderer,
} from "./hardware/video";
import { RomLoader } from "./hardware/romloader";

const GAMEBOY_MEMORY_SIZE = 0x10000;
const DEFAULT_ROM_PATH = "./roms/tetris.gb";
const GAMEBOY_CPU_HZ = 4_194_304;
const GAMEBOY_FRAME_CYCLES = 70_224;
const GAMEBOY_FRAME_RATE = GAMEBOY_CPU_HZ / GAMEBOY_FRAME_CYCLES;
const MAX_CATCH_UP_MS = 100;
const MAX_CYCLES_PER_PUMP = GAMEBOY_FRAME_CYCLES * 2;
const SERVER_PORT = Number(process.env.PORT ?? 3030);
const TRACE_SIZE = 64;
const LOAD_FROM_SNAPSHOT = true;
const SNAPSHOT_PATH = "./state/unknown-opcode-snapshot.json";

type EmulatorState = {
    running: boolean;
    error: string | null;
    instructions: number;
    frames: number;
    cycles: number;
    screenMode: "lcd" | "debug";
};

type TraceEntry = {
    pc: number;
    opcode: number;
    nextByte: number;
    highByte: number;
    sp: number;
};

type EmulatorSnapshot = {
    version: 1;
    romPath: string;
    cpu: CpuStateSnapshot;
    memory: MemoryStateSnapshot;
    emulator: {
        state: EmulatorState;
        recentTrace: TraceEntry[];
        pendingCycles: number;
        frameCycleBudget: number;
    };
};

const JOYPAD_KEYS: Record<string, JoypadButton> = {
    d: "right",
    a: "left",
    w: "up",
    s: "down",
    z: "a",
    x: "b",
    Shift: "select",
    Enter: "start",
};
const JOYPAD_BUTTONS = new Set<JoypadButton>([
    "right",
    "left",
    "up",
    "down",
    "a",
    "b",
    "select",
    "start",
]);

const romPath = process.argv[2] ?? DEFAULT_ROM_PATH;
const romLoader = new RomLoader();
const romData = romLoader.loadRom(romPath);
const memory = new Memory(GAMEBOY_MEMORY_SIZE);

memory.loadCartridge(romData);

const cpu = new CPU(memory);
memory.initializeDmgPostBootState();
cpu.initializeDmgPostBootState();
const video = new VideoRenderer(memory);
const state: EmulatorState = {
    running: true,
    error: null,
    instructions: 0,
    frames: 0,
    cycles: 0,
    screenMode: "lcd",
};

let screenFrame = video.renderScreen();
let tileFrame = video.renderTileAtlas({ applyPalette: false });
const recentTrace: TraceEntry[] = [];
let pendingCycles = 0;
let frameCycleBudget = 0;
let lastPumpTimestamp = performance.now();

function toHex(value: number, width = 2): string {
    return `0x${value.toString(16).toUpperCase().padStart(width, "0")}`;
}

function getInstructionCycles(opcode: number, nextByte: number): number {
    if (opcode >= 0x40 && opcode <= 0x7F) {
        if (opcode === 0x76) {
            return 4;
        }

        const destinationCode = (opcode >> 3) & 0x07;
        const sourceCode = opcode & 0x07;
        return destinationCode === 6 || sourceCode === 6 ? 8 : 4;
    }

    if (opcode === 0xCB) {
        if (nextByte >= 0x40) {
            const registerCode = nextByte & 0x07;
            return registerCode === 6 ? 16 : 8;
        }
    }

    switch (opcode) {
        case 0x00:
        case 0x0F:
        case 0x76:
        case 0x80:
        case 0x81:
        case 0x82:
        case 0x83:
        case 0x84:
        case 0x85:
        case 0x87:
        case 0x90:
        case 0x91:
        case 0x92:
        case 0x93:
        case 0x94:
        case 0x95:
        case 0x97:
        case 0x9F:
        case 0xA7:
        case 0xAF:
        case 0xB0:
        case 0xB1:
        case 0xB3:
        case 0xCF:
        case 0xF3:
        case 0xFB:
            return 4;
        case 0x04:
        case 0x05:
        case 0x0C:
        case 0x0D:
        case 0x15:
        case 0x18:
        case 0x1D:
        case 0x24:
        case 0x3C:
        case 0x3D:
            return opcode === 0x18 ? 12 : 4;
        case 0x03:
        case 0x09:
        case 0x0B:
        case 0x13:
        case 0x19:
        case 0x1B:
        case 0x23:
        case 0x29:
        case 0x2B:
        case 0x33:
        case 0x39:
        case 0xE1:
        case 0xF1:
            return (opcode === 0xE1 || opcode === 0xF1) ? 12 : 8;
        case 0x01:
        case 0x06:
        case 0x08:
        case 0x0E:
        case 0x11:
        case 0x16:
        case 0x1E:
        case 0x21:
        case 0x26:
        case 0x2E:
        case 0x31:
        case 0x36:
        case 0xE0:
        case 0xE6:
        case 0xF0:
        case 0xFE:
            if (opcode === 0x08) {
                return 20;
            }
            if (opcode === 0x01 || opcode === 0x11 || opcode === 0x21 || opcode === 0x31) {
                return 12;
            }
            if (opcode === 0x36) {
                return 12;
            }
            return 8;
        case 0x02:
        case 0x12:
        case 0x1A:
        case 0x22:
        case 0x2A:
        case 0x32:
        case 0x3A:
        case 0x66:
        case 0x71:
        case 0x77:
        case 0x7E:
        case 0xD1:
        case 0xE2:
        case 0xF2:
        case 0xF9:
            return opcode === 0xD1 ? 12 : (opcode === 0xF9 ? 8 : 8);
        case 0x20:
            return cpu.flags.z ? 8 : 12;
        case 0x28:
            return cpu.flags.z ? 12 : 8;
        case 0x30:
            return cpu.flags.c ? 8 : 12;
        case 0xC0:
            return cpu.flags.z ? 8 : 20;
        case 0xC1:
            return 12;
        case 0xC2:
            return cpu.flags.z ? 12 : 16;
        case 0xC3:
            return 16;
        case 0xC5:
            return 16;
        case 0xC8:
            return cpu.flags.z ? 20 : 8;
        case 0xC9:
            return 16;
        case 0xCA:
            return cpu.flags.z ? 16 : 12;
        case 0xCB:
            switch (nextByte) {
                case 0x11:
                case 0x1A:
                    return 8;
                default:
                    return 8;
            }
        case 0xCD:
            return 24;
        case 0xD0:
            return cpu.flags.c ? 8 : 20;
        case 0xD2:
            return cpu.flags.c ? 12 : 16;
        case 0xD5:
        case 0xE5:
        case 0xF5:
            return 16;
        case 0xDA:
            return cpu.flags.c ? 16 : 12;
        case 0xE9:
            return 4;
        case 0xEA:
        case 0xFA:
            return 16;
        case 0xFF:
            return 16;
        default:
            return 4;
    }
}

function stepCpu(): number {
    const interruptCycles = cpu.serviceInterrupts();
    if (interruptCycles > 0) {
        memory.tick(interruptCycles);
        state.cycles += interruptCycles;
        return interruptCycles;
    }

    if (cpu.halted) {
        memory.tick(4);
        state.cycles += 4;
        return 4;
    }

    const instructionAddress = cpu.pc;
    const opcode = memory.readByte(instructionAddress);
    const nextByte = memory.readByte((instructionAddress + 1) & 0xFFFF);
    const highByte = memory.readByte((instructionAddress + 2) & 0xFFFF);
    const cycles = getInstructionCycles(opcode, nextByte);

    recentTrace.push({
        pc: instructionAddress,
        opcode,
        nextByte,
        highByte,
        sp: cpu.sp,
    });

    if (recentTrace.length > TRACE_SIZE) {
        recentTrace.shift();
    }

    cpu.execute(opcode, nextByte, nextByte, highByte);
    memory.tick(cycles);
    state.instructions += 1;
    state.cycles += cycles;

    return cycles;
}

function refreshFrames(): void {
    const lcdFrame = video.renderScreen();
    const debugFrame = video.renderScreen({
        applyPalette: false,
        respectLcdEnable: false,
    });

    if (video.countUniqueShades(lcdFrame) > 1) {
        screenFrame = lcdFrame;
        state.screenMode = "lcd";
    } else {
        screenFrame = debugFrame;
        state.screenMode = "debug";
    }

    tileFrame = video.renderTileAtlas({ applyPalette: false });
    state.frames += 1;
}

function pumpEmulator(): void {
    if (!state.running) {
        return;
    }

    const now = performance.now();
    const elapsedMs = Math.min(now - lastPumpTimestamp, MAX_CATCH_UP_MS);
    lastPumpTimestamp = now;
    pendingCycles += elapsedMs * (GAMEBOY_CPU_HZ / 1000);

    try {
        let executedCycles = 0;

        while (pendingCycles >= 4 && executedCycles < MAX_CYCLES_PER_PUMP) {
            const consumedCycles = stepCpu();
            pendingCycles -= consumedCycles;
            executedCycles += consumedCycles;
            frameCycleBudget += consumedCycles;
        }

        while (frameCycleBudget >= GAMEBOY_FRAME_CYCLES) {
            refreshFrames();
            frameCycleBudget -= GAMEBOY_FRAME_CYCLES;
        }
    } catch (error) {
        if (shouldSaveSnapshot(error)) {
            saveSnapshot();
        }
        state.running = false;
        state.error = error instanceof Error ? error.stack ?? error.message : String(error);
    }

    if (!state.running) {
        refreshFrames();
        return;
    }

    setImmediate(pumpEmulator);
}

function writeBuffer(response: ServerResponse, buffer: Uint8Array): void {
    response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": buffer.byteLength,
        "Content-Type": "application/octet-stream",
    });
    response.end(Buffer.from(buffer));
}

function writeJson(response: ServerResponse, payload: unknown): void {
    response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(payload));
}

function writeNoContent(response: ServerResponse): void {
    response.writeHead(204, {
        "Cache-Control": "no-store",
    });
    response.end();
}

function shouldSaveSnapshot(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    return error.message.includes("Unknown opcode") || error.message.includes("Unknown CB opcode");
}

function saveSnapshot(): void {
    const snapshot: EmulatorSnapshot = {
        version: 1,
        romPath,
        cpu: cpu.saveState(),
        memory: memory.saveState(),
        emulator: {
            state: {
                ...state,
                running: true,
                error: null,
            },
            recentTrace: recentTrace.map((entry) => ({ ...entry })),
            pendingCycles,
            frameCycleBudget,
        },
    };

    mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot));
}

function loadSnapshot(): boolean {
    if (!LOAD_FROM_SNAPSHOT || !existsSync(SNAPSHOT_PATH)) {
        return false;
    }

    const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as EmulatorSnapshot;
    if (snapshot.version !== 1 || snapshot.romPath !== romPath) {
        return false;
    }

    memory.loadState(snapshot.memory);
    cpu.loadState(snapshot.cpu);

    state.running = true;
    state.error = null;
    state.instructions = snapshot.emulator.state.instructions;
    state.frames = snapshot.emulator.state.frames;
    state.cycles = snapshot.emulator.state.cycles;
    state.screenMode = snapshot.emulator.state.screenMode;

    recentTrace.length = 0;
    recentTrace.push(...snapshot.emulator.recentTrace.map((entry) => ({ ...entry })));
    pendingCycles = snapshot.emulator.pendingCycles;
    frameCycleBudget = snapshot.emulator.frameCycleBudget;
    lastPumpTimestamp = performance.now();

    return true;
}

function buildDashboardHtml(): string {
    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>miniGB video debug</title>
    <style>
        :root {
            --bg: #101812;
            --panel: #17241b;
            --panel-2: #213126;
            --ink: #d7f0d0;
            --muted: #8bab84;
            --accent: #9fdd6f;
            --border: #35503c;
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            min-height: 100vh;
            font-family: Consolas, "Courier New", monospace;
            color: var(--ink);
            background:
                radial-gradient(circle at top, rgba(159, 221, 111, 0.14), transparent 30%),
                linear-gradient(180deg, #0d140f 0%, var(--bg) 100%);
        }

        main {
            width: min(1200px, calc(100vw - 32px));
            margin: 0 auto;
            padding: 24px 0 32px;
        }

        h1 {
            margin: 0 0 8px;
            font-size: 28px;
            letter-spacing: 0.04em;
            text-transform: uppercase;
        }

        p {
            margin: 0;
            color: var(--muted);
        }

        .layout {
            display: grid;
            grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr);
            gap: 20px;
            margin-top: 24px;
        }

        .card {
            background: linear-gradient(180deg, rgba(33, 49, 38, 0.95), rgba(23, 36, 27, 0.96));
            border: 1px solid var(--border);
            border-radius: 18px;
            padding: 18px;
            box-shadow: 0 18px 40px rgba(0, 0, 0, 0.25);
        }

        .card h2 {
            margin: 0 0 12px;
            font-size: 15px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        canvas {
            width: 100%;
            image-rendering: pixelated;
            border-radius: 12px;
            border: 1px solid rgba(215, 240, 208, 0.1);
            background: #e0f8d0;
        }

        #screen {
            aspect-ratio: 160 / 144;
        }

        #tiles {
            aspect-ratio: 128 / 192;
        }

        .stats {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
        }

        .stat {
            padding: 10px 12px;
            border-radius: 12px;
            background: rgba(16, 24, 18, 0.65);
            border: 1px solid rgba(215, 240, 208, 0.08);
        }

        .stat strong {
            display: block;
            margin-bottom: 4px;
            color: var(--muted);
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
        }

        pre {
            margin: 0;
            padding: 12px;
            overflow: auto;
            border-radius: 12px;
            background: rgba(12, 18, 13, 0.82);
            border: 1px solid rgba(215, 240, 208, 0.08);
            color: #c6e6be;
            font-size: 13px;
            line-height: 1.5;
        }

        .status-running {
            color: var(--accent);
        }

        .status-stopped {
            color: #ff8a80;
        }

        .controls-grid {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 8px;
        }

        .control-button {
            padding: 12px 10px;
            border: 1px solid rgba(215, 240, 208, 0.14);
            border-radius: 12px;
            background: rgba(16, 24, 18, 0.75);
            color: var(--ink);
            font: inherit;
            cursor: pointer;
            transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
        }

        .control-button:hover,
        .control-button:focus-visible {
            background: rgba(33, 49, 38, 0.95);
            border-color: rgba(159, 221, 111, 0.5);
            outline: none;
        }

        .control-button:active,
        .control-button.is-active {
            transform: translateY(1px);
            background: rgba(59, 86, 62, 0.95);
            border-color: rgba(159, 221, 111, 0.8);
        }

        @media (max-width: 900px) {
            .layout {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body tabindex="0">
    <main>
        <h1>miniGB live video</h1>
        <p>Salida de depuracion para ver la pantalla y los tiles de VRAM mientras evoluciona el emulador.</p>

        <section class="layout">
            <div>
                <div class="card">
                    <h2>LCD</h2>
                    <canvas id="screen" width="${LCD_WIDTH}" height="${LCD_HEIGHT}"></canvas>
                </div>
                <div class="card" style="margin-top: 20px;">
                    <h2>Tileset VRAM</h2>
                    <canvas id="tiles" width="${TILESET_WIDTH}" height="${TILESET_HEIGHT}"></canvas>
                </div>
            </div>

            <div class="card">
                <h2>Estado</h2>
                <div class="stats">
                    <div class="stat"><strong>ROM</strong><span id="rom-path"></span></div>
                    <div class="stat"><strong>Status</strong><span id="status"></span></div>
                    <div class="stat"><strong>Frames</strong><span id="frames"></span></div>
                    <div class="stat"><strong>Cycles</strong><span id="cycles"></span></div>
                    <div class="stat"><strong>Instructions</strong><span id="instructions"></span></div>
                    <div class="stat"><strong>PC</strong><span id="pc"></span></div>
                    <div class="stat"><strong>SP</strong><span id="sp"></span></div>
                    <div class="stat"><strong>JOYP</strong><span id="joyp"></span></div>
                    <div class="stat"><strong>LCDC</strong><span id="lcdc"></span></div>
                    <div class="stat"><strong>LY</strong><span id="ly"></span></div>
                    <div class="stat"><strong>Screen mode</strong><span id="screen-mode"></span></div>
                    <div class="stat"><strong>VRAM non-zero</strong><span id="vram-non-zero"></span></div>
                </div>

                <h2 style="margin-top: 18px;">Registers</h2>
                <pre id="registers"></pre>

                <h2 style="margin-top: 18px;">Video notes</h2>
                <pre id="video-notes"></pre>

                <h2 style="margin-top: 18px;">Controls</h2>
                <pre>WASD = D-pad
Z = A
X = B
Enter = Start
Shift = Select</pre>
                <div class="controls-grid" style="margin-top: 12px;">
                    <button class="control-button" data-button="up">Up</button>
                    <button class="control-button" data-button="left">Left</button>
                    <button class="control-button" data-button="down">Down</button>
                    <button class="control-button" data-button="right">Right</button>
                    <button class="control-button" data-button="a">A</button>
                    <button class="control-button" data-button="b">B</button>
                    <button class="control-button" data-button="select">Select</button>
                    <button class="control-button" data-button="start">Start</button>
                </div>
                <pre id="input-status" style="margin-top: 12px;">Input idle.</pre>

                <h2 style="margin-top: 18px;">Last error</h2>
                <pre id="error">No errors.</pre>
            </div>
        </section>
    </main>

    <script>
        const palette = [
            [224, 248, 208],
            [136, 192, 112],
            [52, 104, 86],
            [8, 24, 32],
        ];

        const screenCanvas = document.getElementById("screen");
        const tilesCanvas = document.getElementById("tiles");
        const screenContext = screenCanvas.getContext("2d");
        const tilesContext = tilesCanvas.getContext("2d");
        const inputStatus = document.getElementById("input-status");
        const controlButtons = Array.from(document.querySelectorAll("[data-button]"));
        const pressedKeys = new Set();
        const keyToButton = {
            d: "right",
            a: "left",
            w: "up",
            s: "down",
            z: "a",
            x: "b",
            Shift: "select",
            Enter: "start",
        };

        function drawFrame(context, width, height, bytes) {
            const imageData = context.createImageData(width, height);

            for (let index = 0; index < bytes.length; index += 1) {
                const shade = bytes[index] ?? 0;
                const [r, g, b] = palette[shade] ?? palette[0];
                const offset = index * 4;

                imageData.data[offset] = r;
                imageData.data[offset + 1] = g;
                imageData.data[offset + 2] = b;
                imageData.data[offset + 3] = 255;
            }

            context.putImageData(imageData, 0, 0);
        }

        function setText(id, value) {
            document.getElementById(id).textContent = value;
        }

        function setInputStatus(message) {
            inputStatus.textContent = message;
        }

        async function fetchBinary(url) {
            const response = await fetch(url, { cache: "no-store" });
            return new Uint8Array(await response.arrayBuffer());
        }

        function normalizeKey(event) {
            return event.key.length === 1 ? event.key.toLowerCase() : event.key;
        }

        function setButtonPressed(button, pressed) {
            for (const element of controlButtons) {
                if (element.dataset.button === button) {
                    element.classList.toggle("is-active", pressed);
                }
            }
        }

        function sendInput(button, pressed, source) {
            setInputStatus((pressed ? "Pressed " : "Released ") + button + " via " + source + ".");
            setButtonPressed(button, pressed);

            fetch("/input?button=" + encodeURIComponent(button) + "&pressed=" + (pressed ? "1" : "0"), {
                cache: "no-store",
                keepalive: true,
            })
                .then(() => {
                    setInputStatus((pressed ? "Pressed " : "Released ") + button + " via " + source + ".");
                })
                .catch((error) => {
                    setInputStatus("Input error: " + String(error));
                });
        }

        function handleKeyDown(event) {
            const key = normalizeKey(event);
            const button = keyToButton[key];

            if (!button || pressedKeys.has(key)) {
                return;
            }

            pressedKeys.add(key);
            event.preventDefault();
            sendInput(button, true, "keyboard");
        }

        function handleKeyUp(event) {
            const key = normalizeKey(event);
            const button = keyToButton[key];

            if (!button) {
                return;
            }

            pressedKeys.delete(key);
            event.preventDefault();
            sendInput(button, false, "keyboard");
        }

        document.addEventListener("keydown", handleKeyDown, true);
        document.addEventListener("keyup", handleKeyUp, true);

        window.addEventListener("blur", () => {
            for (const key of pressedKeys) {
                const button = keyToButton[key];
                if (button) {
                    sendInput(button, false, "blur");
                }
            }

            pressedKeys.clear();
        });

        for (const element of controlButtons) {
            const button = element.dataset.button;
            if (!button) {
                continue;
            }

            element.addEventListener("pointerdown", (event) => {
                event.preventDefault();
                element.setPointerCapture?.(event.pointerId);
                sendInput(button, true, "pointer");
            });

            element.addEventListener("pointerup", (event) => {
                event.preventDefault();
                sendInput(button, false, "pointer");
            });

            element.addEventListener("pointercancel", () => {
                sendInput(button, false, "pointer");
            });

            element.addEventListener("lostpointercapture", () => {
                sendInput(button, false, "pointer");
            });
        }

        window.addEventListener("load", () => {
            window.focus();
            document.body.focus();
            setInputStatus("Input ready. Click the page or use the on-screen buttons if keyboard focus is stubborn.");
        });

        async function tick() {
            try {
                const [screen, tiles, emulatorState] = await Promise.all([
                    fetchBinary("/frame/screen"),
                    fetchBinary("/frame/tiles"),
                    fetch("/state", { cache: "no-store" }).then((response) => response.json()),
                ]);

                drawFrame(screenContext, ${LCD_WIDTH}, ${LCD_HEIGHT}, screen);
                drawFrame(tilesContext, ${TILESET_WIDTH}, ${TILESET_HEIGHT}, tiles);

                setText("rom-path", emulatorState.romPath);
                setText("status", emulatorState.running ? "running" : "stopped");
                document.getElementById("status").className = emulatorState.running ? "status-running" : "status-stopped";
                setText("frames", String(emulatorState.frames));
                setText("cycles", String(emulatorState.cycles));
                setText("instructions", String(emulatorState.instructions));
                setText("pc", emulatorState.registers.pc);
                setText("sp", emulatorState.registers.sp);
                setText("joyp", emulatorState.lcd.joyp);
                setText("lcdc", emulatorState.lcd.lcdc);
                setText("ly", emulatorState.lcd.ly);
                setText("screen-mode", emulatorState.screenMode);
                setText("vram-non-zero", String(emulatorState.video.vramNonZeroBytes));
                setText(
                    "registers",
                    [
                        "AF: " + emulatorState.registers.af,
                        "BC: " + emulatorState.registers.bc,
                        "DE: " + emulatorState.registers.de,
                        "HL: " + emulatorState.registers.hl,
                        "A:  " + emulatorState.registers.a,
                        "B:  " + emulatorState.registers.b,
                        "C:  " + emulatorState.registers.c,
                        "D:  " + emulatorState.registers.d,
                        "E:  " + emulatorState.registers.e,
                        "H:  " + emulatorState.registers.h,
                        "L:  " + emulatorState.registers.l,
                        "F:  " + emulatorState.registers.f,
                    ].join("\\n"),
                );
                setText("video-notes", emulatorState.video.notes.join("\\n"));
                setText(
                    "error",
                    emulatorState.error
                        ? emulatorState.error + "\\n\\nRecent trace:\\n" + emulatorState.trace.join("\\n")
                        : "No errors.",
                );
            } catch (error) {
                setText("error", String(error));
            } finally {
                window.setTimeout(tick, 120);
            }
        }

        tick();
    </script>
</body>
</html>`;
}

function handleRequest(request: IncomingMessage, response: ServerResponse): void {
    const requestUrl = request.url ?? "/";
    const parsedUrl = new URL(requestUrl, `http://localhost:${SERVER_PORT}`);

    if (parsedUrl.pathname === "/") {
        response.writeHead(200, {
            "Cache-Control": "no-store",
            "Content-Type": "text/html; charset=utf-8",
        });
        response.end(buildDashboardHtml());
        return;
    }

    if (parsedUrl.pathname === "/frame/screen") {
        writeBuffer(response, screenFrame);
        return;
    }

    if (parsedUrl.pathname === "/frame/tiles") {
        writeBuffer(response, tileFrame);
        return;
    }

    if (parsedUrl.pathname === "/input") {
        const button = parsedUrl.searchParams.get("button");
        const pressed = parsedUrl.searchParams.get("pressed") === "1";

        if (!button || !JOYPAD_BUTTONS.has(button as JoypadButton)) {
            response.writeHead(400, {
                "Content-Type": "text/plain; charset=utf-8",
            });
            response.end("Invalid joypad button");
            return;
        }

        memory.setJoypadButton(button as JoypadButton, pressed);
        writeNoContent(response);
        return;
    }

    if (parsedUrl.pathname === "/state") {
        writeJson(response, {
            romPath,
            running: state.running,
            error: state.error,
            instructions: state.instructions,
            frames: state.frames,
            cycles: state.cycles,
            screenMode: state.screenMode,
            registers: {
                a: toHex(cpu.a),
                b: toHex(cpu.b),
                c: toHex(cpu.c),
                d: toHex(cpu.d),
                e: toHex(cpu.e),
                f: toHex(cpu.f),
                h: toHex(cpu.h),
                l: toHex(cpu.l),
                af: toHex((cpu.a << 8) | cpu.f, 4),
                bc: toHex((cpu.b << 8) | cpu.c, 4),
                de: toHex((cpu.d << 8) | cpu.e, 4),
                hl: toHex((cpu.h << 8) | cpu.l, 4),
                pc: toHex(cpu.pc, 4),
                sp: toHex(cpu.sp, 4),
            },
            lcd: {
                joyp: toHex(memory.peekByte(0xFF00)),
                lcdc: toHex(memory.peekByte(0xFF40)),
                ly: toHex(memory.peekByte(0xFF44)),
                scx: toHex(memory.peekByte(0xFF43)),
                scy: toHex(memory.peekByte(0xFF42)),
                bgp: toHex(memory.peekByte(0xFF47)),
            },
            video: {
                vramNonZeroBytes: video.countNonZeroVramBytes(),
                notes: [
                    state.screenMode === "debug"
                        ? "LCD real blank; showing fallback debug view."
                        : "Showing LCD view with current palette.",
                    memory.peekByte(0xFF40) === 0
                        ? "LCDC is 0x00, the ROM still has the LCD disabled or has not initialized it yet."
                        : `LCDC active: ${toHex(memory.peekByte(0xFF40))}`,
                    memory.peekByte(0xFF47) === 0
                        ? "BGP is 0x00, so the hardware palette collapses all colors to white."
                        : `BGP palette: ${toHex(memory.peekByte(0xFF47))}`,
                    `Target speed: ${GAMEBOY_FRAME_RATE.toFixed(2)} FPS / ${GAMEBOY_CPU_HZ.toLocaleString()} Hz`,
                ],
            },
            trace: recentTrace.slice(-12).map((entry) =>
                `pc=${toHex(entry.pc, 4)} op=${toHex(entry.opcode)} next=[${toHex(entry.nextByte)}, ${toHex(entry.highByte)}] sp=${toHex(entry.sp, 4)}`,
            ),
        });
        return;
    }

    response.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Not found");
}

loadSnapshot();
refreshFrames();

createServer(handleRequest).listen(SERVER_PORT, () => {
    console.log(`miniGB video debug available at http://localhost:${SERVER_PORT}`);
    console.log(`ROM loaded from ${romPath} (${romData.length} bytes)`);
    console.log(LOAD_FROM_SNAPSHOT ? `snapshot restore enabled (${SNAPSHOT_PATH})` : "snapshot restore disabled");
});

pumpEmulator();
