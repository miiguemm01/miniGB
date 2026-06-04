import { EventEmitter } from "events";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { basename, dirname, extname } from "path";
import { CPU } from "../hardware/cpu";
import { HardwareModel, JoypadButton, Memory } from "../hardware/memory";
import { VideoRenderer } from "../hardware/video";
import { RomLoader } from "../hardware/romloader";
import {
    DashboardStatePayload,
    EmulatorFramePayload,
    EmulatorSnapshot,
    EmulatorState,
    SaveStateAction,
    SaveStateActionResult,
    SaveStateInfo,
    SessionOptions,
    TraceEntry,
} from "./types";

const GAMEBOY_MEMORY_SIZE = 0x10000;
const GAMEBOY_CPU_HZ = 4_194_304;
const GAMEBOY_FRAME_CYCLES = 70_224;
const GAMEBOY_FRAME_RATE = GAMEBOY_CPU_HZ / GAMEBOY_FRAME_CYCLES;
const MAX_CATCH_UP_MS = 100;
const MAX_CYCLES_PER_PUMP = GAMEBOY_FRAME_CYCLES * 2;
const TRACE_SIZE = 64;
const SPEED_MULTIPLIER_OPTIONS = new Set([1, 2, 4, 8]);

export const DEFAULT_ROM_PATH = "./roms/pkmncrstl.gbc";
export const DEFAULT_HARDWARE_MODEL: HardwareModel = "cgb";

export class MiniGbSession extends EventEmitter {
    private readonly romPath: string | null;
    private readonly hardwareModel: HardwareModel;
    private readonly snapshotPath: string | null;
    private readonly saveStatePath: string | null;
    private readonly memory: Memory;
    private readonly cpu: CPU;
    private readonly video: VideoRenderer;
    private readonly state: EmulatorState = {
        running: true,
        error: null,
        instructions: 0,
        frames: 0,
        cycles: 0,
        speedMultiplier: 1,
        screenMode: "lcd",
    };
    private readonly recentTrace: TraceEntry[] = [];
    private readonly romData: Uint8Array | null;

    private screenFrame: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    private tileFrame: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    private screenFrameBase64 = "";
    private tileFrameBase64 = "";
    private pendingCycles = 0;
    private frameCycleBudget = 0;
    private lastPumpTimestamp = performance.now();
    private pumpScheduled = false;

    constructor(options: SessionOptions = {}) {
        super();

        this.romPath = options.romPath ?? null;
        this.hardwareModel = options.hardwareModel ?? DEFAULT_HARDWARE_MODEL;
        this.memory = new Memory(GAMEBOY_MEMORY_SIZE);
        this.cpu = new CPU(this.memory);
        this.memory.initializePostBootState(this.hardwareModel);

        if (this.hardwareModel === "cgb") {
            this.cpu.initializeCgbPostBootState();
        } else {
            this.cpu.initializeDmgPostBootState();
        }

        this.video = new VideoRenderer(this.memory);

        if (this.romPath) {
            const romLoader = new RomLoader();
            this.romData = romLoader.loadRom(this.romPath);
            this.memory.loadCartridge(this.romData);

            const romSaveName = basename(this.romPath, extname(this.romPath)).replace(/[^a-zA-Z0-9_-]/g, "_");
            this.snapshotPath = `./state/${romSaveName}-unknown-opcode-snapshot.json`;
            this.saveStatePath = `./state/${romSaveName}-savestate.json`;
        } else {
            this.romData = null;
            this.snapshotPath = null;
            this.saveStatePath = null;
            this.state.running = false;
        }

        const restored = this.snapshotPath !== null
            && options.loadFromSnapshot === true
            && this.loadSnapshot(this.snapshotPath);
        if (!restored) {
            this.refreshFrames();
        }
    }

    start(): void {
        this.schedulePump();
    }

    subscribe(listener: (payload: EmulatorFramePayload) => void): () => void {
        this.on("frame", listener);
        return () => {
            this.off("frame", listener);
        };
    }

    getCurrentFramePayload(includeTiles = true): EmulatorFramePayload {
        return {
            state: this.buildDashboardStatePayload(),
            screen: this.screenFrameBase64,
            tiles: includeTiles ? this.tileFrameBase64 : null,
        };
    }

    getRomInfo(): { romPath: string | null; byteLength: number; snapshotPath: string | null; saveStatePath: string | null } {
        return {
            romPath: this.romPath,
            byteLength: this.romData?.length ?? 0,
            snapshotPath: this.snapshotPath,
            saveStatePath: this.saveStatePath,
        };
    }

    setJoypadButton(button: JoypadButton, pressed: boolean): void {
        this.memory.setJoypadButton(button, pressed);
    }

    setSpeedMultiplier(multiplier: number): DashboardStatePayload {
        const normalizedMultiplier = SPEED_MULTIPLIER_OPTIONS.has(multiplier) ? multiplier : 1;
        if (this.state.speedMultiplier !== normalizedMultiplier) {
            // Drop stale backlog so the new speed applies from this instant.
            this.pendingCycles = 0;
            this.lastPumpTimestamp = performance.now();
        }

        this.state.speedMultiplier = normalizedMultiplier;
        this.broadcastDashboardUpdate(false);
        this.schedulePump();
        return this.buildDashboardStatePayload();
    }

    handleSaveStateAction(action: SaveStateAction): SaveStateActionResult {
        if (!this.romPath || !this.saveStatePath) {
            return {
                ok: false,
                message: "No hay una ROM cargada. Usa File > Open ROM... primero.",
                saveState: this.getEmptySaveStateInfo(),
            };
        }

        if (action === "save") {
            this.saveSnapshot(this.saveStatePath);
            return {
                ok: true,
                message: `Savestate guardado en ${this.saveStatePath}.`,
                saveState: this.getSaveStateInfo(this.saveStatePath),
            };
        }

        if (!this.loadSnapshot(this.saveStatePath)) {
            return {
                ok: false,
                message: "No hay savestate valido para esta ROM.",
                saveState: this.getSaveStateInfo(this.saveStatePath),
            };
        }

        this.schedulePump();

        return {
            ok: true,
            message: `Savestate cargado desde ${this.saveStatePath}.`,
            saveState: this.getSaveStateInfo(this.saveStatePath),
        };
    }

    private getEmptySaveStateInfo(): SaveStateInfo {
        return {
            exists: false,
            path: "No ROM loaded",
            updatedAt: null,
        };
    }

    private schedulePump(): void {
        if (this.pumpScheduled || !this.state.running) {
            return;
        }

        this.pumpScheduled = true;
        setImmediate(() => {
            this.pumpScheduled = false;
            this.pumpEmulator();
        });
    }

    private toHex(value: number, width = 2): string {
        return `0x${value.toString(16).toUpperCase().padStart(width, "0")}`;
    }

    private getInstructionCycles(opcode: number, nextByte: number): number {
        if (opcode >= 0x40 && opcode <= 0x7F) {
            if (opcode === 0x76) {
                return 4;
            }

            const destinationCode = (opcode >> 3) & 0x07;
            const sourceCode = opcode & 0x07;
            return destinationCode === 6 || sourceCode === 6 ? 8 : 4;
        }

        if (opcode === 0xCB && nextByte >= 0x40) {
            const registerCode = nextByte & 0x07;
            return registerCode === 6 ? 16 : 8;
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
                return opcode === 0xE1 || opcode === 0xF1 ? 12 : 8;
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
                return opcode === 0xD1 ? 12 : 8;
            case 0x20:
                return this.cpu.flags.z ? 8 : 12;
            case 0x28:
                return this.cpu.flags.z ? 12 : 8;
            case 0x30:
                return this.cpu.flags.c ? 8 : 12;
            case 0xC0:
                return this.cpu.flags.z ? 8 : 20;
            case 0xC1:
                return 12;
            case 0xC2:
                return this.cpu.flags.z ? 12 : 16;
            case 0xC3:
                return 16;
            case 0xC5:
                return 16;
            case 0xC8:
                return this.cpu.flags.z ? 20 : 8;
            case 0xC9:
                return 16;
            case 0xCA:
                return this.cpu.flags.z ? 16 : 12;
            case 0xCB:
                return 8;
            case 0xCD:
                return 24;
            case 0xD0:
                return this.cpu.flags.c ? 8 : 20;
            case 0xD2:
                return this.cpu.flags.c ? 12 : 16;
            case 0xD5:
            case 0xE5:
            case 0xF5:
                return 16;
            case 0xDA:
                return this.cpu.flags.c ? 16 : 12;
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

    private stepCpu(): number {
        const interruptCycles = this.cpu.serviceInterrupts();
        if (interruptCycles > 0) {
            const effectiveCycles = this.memory.getEffectiveSystemCycles(interruptCycles);
            this.memory.tick(interruptCycles);
            this.state.cycles += effectiveCycles;
            return effectiveCycles;
        }

        if (this.cpu.halted) {
            const effectiveCycles = this.memory.getEffectiveSystemCycles(4);
            this.memory.tick(4);
            this.state.cycles += effectiveCycles;
            return effectiveCycles;
        }

        const instructionAddress = this.cpu.pc;
        const opcode = this.memory.readByte(instructionAddress);
        const nextByte = this.memory.readByte((instructionAddress + 1) & 0xFFFF);
        const highByte = this.memory.readByte((instructionAddress + 2) & 0xFFFF);
        const cycles = this.getInstructionCycles(opcode, nextByte);
        const effectiveCycles = this.memory.getEffectiveSystemCycles(cycles);

        this.recentTrace.push({
            pc: instructionAddress,
            opcode,
            nextByte,
            highByte,
            sp: this.cpu.sp,
        });

        if (this.recentTrace.length > TRACE_SIZE) {
            this.recentTrace.shift();
        }

        this.cpu.execute(opcode, nextByte, nextByte, highByte);
        this.memory.tick(cycles);
        this.state.instructions += 1;
        this.state.cycles += effectiveCycles;

        return effectiveCycles;
    }

    private refreshFrames(): void {
        const lcdFrame = this.video.renderScreen();
        const debugFrame = this.video.renderScreen({
            applyPalette: false,
            respectLcdEnable: false,
        });

        if (this.video.countUniqueShades(lcdFrame) > 1) {
            this.screenFrame = lcdFrame;
            this.state.screenMode = "lcd";
        } else {
            this.screenFrame = debugFrame;
            this.state.screenMode = "debug";
        }

        this.tileFrame = this.video.renderTileAtlas({ applyPalette: false });
        this.screenFrameBase64 = Buffer.from(this.screenFrame).toString("base64");
        this.tileFrameBase64 = Buffer.from(this.tileFrame).toString("base64");
        this.state.frames += 1;
        this.broadcastDashboardUpdate(this.state.frames % 8 === 0 || !this.state.running);
    }

    private pumpEmulator(): void {
        if (!this.state.running) {
            return;
        }

        const now = performance.now();
        const elapsedMs = Math.min(now - this.lastPumpTimestamp, MAX_CATCH_UP_MS);
        this.lastPumpTimestamp = now;
        this.pendingCycles += elapsedMs * (GAMEBOY_CPU_HZ / 1000) * this.state.speedMultiplier;

        try {
            let executedCycles = 0;

            const maxCyclesPerPump = MAX_CYCLES_PER_PUMP * this.state.speedMultiplier;

            while (this.pendingCycles >= 4 && executedCycles < maxCyclesPerPump) {
                const consumedCycles = this.stepCpu();
                this.pendingCycles -= consumedCycles;
                executedCycles += consumedCycles;
                this.frameCycleBudget += consumedCycles;
            }

            while (this.frameCycleBudget >= GAMEBOY_FRAME_CYCLES) {
                this.refreshFrames();
                this.frameCycleBudget -= GAMEBOY_FRAME_CYCLES;
            }
        } catch (error) {
            if (this.snapshotPath && this.shouldSaveSnapshot(error)) {
                this.saveSnapshot(this.snapshotPath);
            }
            this.state.running = false;
            this.state.error = error instanceof Error ? error.stack ?? error.message : String(error);
        }

        if (!this.state.running) {
            this.refreshFrames();
            return;
        }

        this.schedulePump();
    }

    private buildDashboardStatePayload(): DashboardStatePayload {
        const cartridgeInfo = this.memory.getCartridgeInfo();
        const hasRomLoaded = this.romPath !== null;
        const cartridgeFeatures = [
            cartridgeInfo.hasBattery ? "battery" : null,
            cartridgeInfo.hasRtc ? "rtc" : null,
            cartridgeInfo.hasRumble ? "rumble" : null,
            cartridgeInfo.cgbSupported ? (cartridgeInfo.cgbOnly ? "cgb-only" : "cgb") : null,
            !cartridgeInfo.cgbSupported && this.memory.isDmgCompatibilityColorModeEnabled() ? "gbc-colorized" : null,
        ].filter((feature): feature is string => feature !== null);

        return {
            romPath: this.romPath ?? "No ROM loaded",
            running: this.state.running,
            error: this.state.error,
            instructions: this.state.instructions,
            frames: this.state.frames,
            cycles: this.state.cycles,
            speedMultiplier: this.state.speedMultiplier,
            screenMode: this.state.screenMode,
            cartridge: {
                title: hasRomLoaded ? cartridgeInfo.title : "No ROM loaded",
                typeCode: this.toHex(cartridgeInfo.typeCode),
                typeName: hasRomLoaded ? cartridgeInfo.typeName : "Waiting for cartridge",
                mapper: cartridgeInfo.mapper.toUpperCase(),
                romBanks: cartridgeInfo.romBanks,
                ramBanks: cartridgeInfo.ramBanks,
                features: cartridgeFeatures,
            },
            registers: {
                a: this.toHex(this.cpu.a),
                b: this.toHex(this.cpu.b),
                c: this.toHex(this.cpu.c),
                d: this.toHex(this.cpu.d),
                e: this.toHex(this.cpu.e),
                f: this.toHex(this.cpu.f),
                h: this.toHex(this.cpu.h),
                l: this.toHex(this.cpu.l),
                af: this.toHex((this.cpu.a << 8) | this.cpu.f, 4),
                bc: this.toHex((this.cpu.b << 8) | this.cpu.c, 4),
                de: this.toHex((this.cpu.d << 8) | this.cpu.e, 4),
                hl: this.toHex((this.cpu.h << 8) | this.cpu.l, 4),
                pc: this.toHex(this.cpu.pc, 4),
                sp: this.toHex(this.cpu.sp, 4),
            },
            lcd: {
                joyp: this.toHex(this.memory.peekByte(0xFF00)),
                lcdc: this.toHex(this.memory.peekByte(0xFF40)),
                ly: this.toHex(this.memory.peekByte(0xFF44)),
                scx: this.toHex(this.memory.peekByte(0xFF43)),
                scy: this.toHex(this.memory.peekByte(0xFF42)),
                bgp: this.toHex(this.memory.peekByte(0xFF47)),
            },
            video: {
                vramNonZeroBytes: this.video.countNonZeroVramBytes(),
                notes: [
                    !hasRomLoaded
                        ? "No hay ROM cargada. Usa File > Open ROM... para arrancar una."
                        : null,
                    this.state.screenMode === "debug"
                        ? "LCD real blank; showing fallback debug view."
                        : "Showing LCD view with current palette.",
                    this.memory.peekByte(0xFF40) === 0
                        ? "LCDC is 0x00, the ROM still has the LCD disabled or has not initialized it yet."
                        : `LCDC active: ${this.toHex(this.memory.peekByte(0xFF40))}`,
                    this.memory.peekByte(0xFF47) === 0
                        ? "BGP is 0x00, so the hardware palette collapses all colors to white."
                        : `BGP palette: ${this.toHex(this.memory.peekByte(0xFF47))}`,
                    this.memory.isCgbModeEnabled()
                        ? "CGB color mode enabled: VRAM bank 1 and color palettes are active."
                        : (this.memory.isDmgCompatibilityColorModeEnabled()
                            ? `DMG game colorized with compatibility palette: ${this.memory.getDmgCompatibilityPaletteName()}.`
                            : "DMG monochrome mode active."),
                    `Target speed: ${GAMEBOY_FRAME_RATE.toFixed(2)} FPS / ${GAMEBOY_CPU_HZ.toLocaleString()} Hz`,
                ].filter((note): note is string => note !== null),
            },
            audio: this.memory.getAudioState(),
            saveState: this.saveStatePath
                ? this.getSaveStateInfo(this.saveStatePath)
                : this.getEmptySaveStateInfo(),
            trace: this.recentTrace.slice(-12).map((entry) =>
                `pc=${this.toHex(entry.pc, 4)} op=${this.toHex(entry.opcode)} next=[${this.toHex(entry.nextByte)}, ${this.toHex(entry.highByte)}] sp=${this.toHex(entry.sp, 4)}`,
            ),
        };
    }

    private broadcastDashboardUpdate(includeTiles: boolean): void {
        this.emit("frame", this.getCurrentFramePayload(includeTiles));
    }

    private buildEmulatorSnapshot(): EmulatorSnapshot {
        if (!this.romPath) {
            throw new Error("Cannot save snapshot without a loaded ROM.");
        }

        return {
            version: 1,
            romPath: this.romPath,
            cpu: this.cpu.saveState(),
            memory: this.memory.saveState(),
            emulator: {
                state: {
                    ...this.state,
                    running: true,
                    error: null,
                },
                recentTrace: this.recentTrace.map((entry) => ({ ...entry })),
                pendingCycles: this.pendingCycles,
                frameCycleBudget: this.frameCycleBudget,
            },
        };
    }

    private getSaveStateInfo(savePath: string): SaveStateInfo {
        if (!existsSync(savePath)) {
            return {
                exists: false,
                path: savePath,
                updatedAt: null,
            };
        }

        return {
            exists: true,
            path: savePath,
            updatedAt: statSync(savePath).mtime.toISOString(),
        };
    }

    private applySnapshot(snapshot: EmulatorSnapshot): void {
        this.memory.loadState(snapshot.memory);
        this.cpu.loadState(snapshot.cpu);

        this.state.running = true;
        this.state.error = null;
        this.state.instructions = snapshot.emulator.state.instructions;
        this.state.frames = snapshot.emulator.state.frames;
        this.state.cycles = snapshot.emulator.state.cycles;
        this.state.speedMultiplier = SPEED_MULTIPLIER_OPTIONS.has(snapshot.emulator.state.speedMultiplier)
            ? snapshot.emulator.state.speedMultiplier
            : 1;
        this.state.screenMode = snapshot.emulator.state.screenMode;

        this.recentTrace.length = 0;
        this.recentTrace.push(...snapshot.emulator.recentTrace.map((entry) => ({ ...entry })));
        this.pendingCycles = snapshot.emulator.pendingCycles;
        this.frameCycleBudget = snapshot.emulator.frameCycleBudget;
        this.lastPumpTimestamp = performance.now();
        this.refreshFrames();
    }

    private shouldSaveSnapshot(error: unknown): boolean {
        return error instanceof Error
            && (error.message.includes("Unknown opcode") || error.message.includes("Unknown CB opcode"));
    }

    private saveSnapshot(filePath: string): void {
        mkdirSync(dirname(filePath), { recursive: true });
        writeFileSync(filePath, JSON.stringify(this.buildEmulatorSnapshot()));
    }

    private loadSnapshot(filePath: string): boolean {
        if (!this.romPath) {
            return false;
        }

        if (!existsSync(filePath)) {
            return false;
        }

        const snapshot = JSON.parse(readFileSync(filePath, "utf8")) as EmulatorSnapshot;
        if (snapshot.version !== 1 || snapshot.romPath !== this.romPath) {
            return false;
        }

        this.applySnapshot(snapshot);
        return true;
    }
}
