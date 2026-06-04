import { CpuStateSnapshot } from "../hardware/cpu";
import { HardwareModel, JoypadButton, MemoryStateSnapshot } from "../hardware/memory";

export type EmulatorState = {
    running: boolean;
    error: string | null;
    instructions: number;
    frames: number;
    cycles: number;
    speedMultiplier: number;
    screenMode: "lcd" | "debug";
};

export type TraceEntry = {
    pc: number;
    opcode: number;
    nextByte: number;
    highByte: number;
    sp: number;
};

export type SaveStateInfo = {
    exists: boolean;
    path: string;
    updatedAt: string | null;
};

export type DashboardStatePayload = {
    romPath: string;
    running: boolean;
    error: string | null;
    instructions: number;
    frames: number;
    cycles: number;
    speedMultiplier: number;
    screenMode: "lcd" | "debug";
    cartridge: {
        title: string;
        typeCode: string;
        typeName: string;
        mapper: string;
        romBanks: number;
        ramBanks: number;
        features: string[];
    };
    registers: {
        a: string;
        b: string;
        c: string;
        d: string;
        e: string;
        f: string;
        h: string;
        l: string;
        af: string;
        bc: string;
        de: string;
        hl: string;
        pc: string;
        sp: string;
    };
    lcd: {
        joyp: string;
        lcdc: string;
        ly: string;
        scx: string;
        scy: string;
        bgp: string;
    };
    video: {
        vramNonZeroBytes: number;
        notes: string[];
    };
    audio: {
        masterEnabled: boolean;
        leftVolume: number;
        rightVolume: number;
        channels: Array<{
            id: 1 | 2 | 3 | 4;
            kind: "square" | "wave" | "noise";
            enabled: boolean;
            frequency: number;
            volume: number;
            duty: number;
            panLeft: boolean;
            panRight: boolean;
            waveSamples: number[];
        }>;
    };
    saveState: SaveStateInfo;
    trace: string[];
};

export type EmulatorSnapshot = {
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

export type EmulatorFramePayload = {
    state: DashboardStatePayload;
    screen: string;
    tiles: string | null;
};

export type SaveStateAction = "save" | "load";

export type SaveStateActionResult = {
    ok: boolean;
    message: string;
    saveState: SaveStateInfo;
};

export type SessionOptions = {
    romPath?: string | null;
    hardwareModel?: HardwareModel;
    loadFromSnapshot?: boolean;
};

export type MiniGbRendererApi = {
    getInitialFrame(): Promise<EmulatorFramePayload>;
    onFrame(listener: (payload: EmulatorFramePayload) => void): () => void;
    setJoypadButton(button: JoypadButton, pressed: boolean): Promise<void>;
    setSpeedMultiplier(multiplier: number): Promise<DashboardStatePayload>;
    saveState(action: SaveStateAction): Promise<SaveStateActionResult>;
};
