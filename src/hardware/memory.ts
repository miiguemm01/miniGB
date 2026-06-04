export type JoypadButton =
    | "right"
    | "left"
    | "up"
    | "down"
    | "a"
    | "b"
    | "select"
    | "start";

export type CartridgeMapper = "rom-only" | "mbc1" | "mbc3" | "mbc5";

export type CartridgeInfo = {
    title: string;
    typeCode: number;
    typeName: string;
    mapper: CartridgeMapper;
    romBanks: number;
    ramBanks: number;
    hasBattery: boolean;
    hasRtc: boolean;
    hasRumble: boolean;
    cgbSupported: boolean;
    cgbOnly: boolean;
};

export type AudioChannelState = {
    id: 1 | 2 | 3 | 4;
    kind: "square" | "wave" | "noise";
    enabled: boolean;
    frequency: number;
    volume: number;
    duty: number;
    panLeft: boolean;
    panRight: boolean;
    waveSamples: number[];
};

export type AudioState = {
    masterEnabled: boolean;
    leftVolume: number;
    rightVolume: number;
    channels: AudioChannelState[];
};

export type HardwareModel = "dmg" | "cgb";

type CompatibilityPaletteSet = {
    bg: [[number, number, number, number], [number, number, number, number], [number, number, number, number], [number, number, number, number]];
    obj0: [[number, number, number, number], [number, number, number, number], [number, number, number, number], [number, number, number, number]];
    obj1: [[number, number, number, number], [number, number, number, number], [number, number, number, number], [number, number, number, number]];
    name: string;
};

export type MemoryStateSnapshot = {
    memory: number[];
    cgbWramBanks: number[];
    cartridgeRam: number[];
    cgbVramBank1: number[];
    cgbBgPaletteRam: number[];
    cgbObjPaletteRam: number[];
    cartridgeType: number;
    romBankCount: number;
    ramBankCount: number;
    currentRomBank: number;
    currentRamBank: number;
    ramEnabled: boolean;
    mbcType: CartridgeMapper;
    mbc1BankingMode: number;
    mbc3RtcRegisters: number[];
    mbc3RtcLatchedRegisters: number[];
    mbc3RtcSelectedRegister: number | null;
    mbc3RtcLatchPrimed: boolean;
    mbc3RtcLastUpdateMs: number;
    audioChannelActive: boolean[];
    cgbFlag: number;
    cgbMode: boolean;
    vramBank: number;
    bgPaletteIndex: number;
    bgPaletteAutoIncrement: boolean;
    objPaletteIndex: number;
    objPaletteAutoIncrement: boolean;
    hardwareModel: HardwareModel;
    dmgCompatibilityColorMode: boolean;
    dmgCompatibilityPaletteName: string;
    wramBank: number;
    doubleSpeedMode: boolean;
    speedSwitchArmed: boolean;
    hdmaSource: number;
    hdmaDestination: number;
    hdmaBlocksRemaining: number;
    hdmaActive: boolean;
    ly: number;
    divCycleCounter: number;
    lcdCycleCounter: number;
    joypSelect: number;
    joypadState: Record<JoypadButton, boolean>;
};

export class Memory {
    private memory: Uint8Array;
    private cgbWramBanks = new Uint8Array(0x7000);
    private cgbVramBank1 = new Uint8Array(0x2000);
    private cgbBgPaletteRam = new Uint8Array(0x40);
    private cgbObjPaletteRam = new Uint8Array(0x40);
    private cartridgeRom: Uint8Array | null = null;
    private cartridgeRam = new Uint8Array(0);
    private cartridgeType = 0x00;
    private cgbFlag = 0x00;
    private cgbMode = false;
    private romBankCount = 1;
    private ramBankCount = 0;
    private currentRomBank = 1;
    private currentRamBank = 0;
    private ramEnabled = false;
    private mbcType: CartridgeMapper = "rom-only";
    private mbc1BankingMode = 0;
    private mbc3RtcRegisters = new Uint8Array(5);
    private mbc3RtcLatchedRegisters = new Uint8Array(5);
    private mbc3RtcSelectedRegister: number | null = null;
    private mbc3RtcLatchPrimed = false;
    private mbc3RtcLastUpdateMs = Date.now();
    private audioChannelActive = [false, false, false, false];
    private vramBank = 0;
    private bgPaletteIndex = 0;
    private bgPaletteAutoIncrement = false;
    private objPaletteIndex = 0;
    private objPaletteAutoIncrement = false;
    private hardwareModel: HardwareModel = "dmg";
    private dmgCompatibilityColorMode = false;
    private dmgCompatibilityPalette: CompatibilityPaletteSet = {
        name: "DMG Green",
        bg: [
            [224, 248, 208, 255],
            [136, 192, 112, 255],
            [52, 104, 86, 255],
            [8, 24, 32, 255],
        ],
        obj0: [
            [224, 248, 208, 255],
            [136, 192, 112, 255],
            [52, 104, 86, 255],
            [8, 24, 32, 255],
        ],
        obj1: [
            [224, 248, 208, 255],
            [136, 192, 112, 255],
            [52, 104, 86, 255],
            [8, 24, 32, 255],
        ],
    };

    private ly = 0; // LCD Y-coordinate register (0xFF44)
    private divCycleCounter = 0;
    private lcdCycleCounter = 0;
    private wramBank = 1;
    private doubleSpeedMode = false;
    private speedSwitchArmed = false;
    private hdmaSource = 0x0000;
    private hdmaDestination = 0x8000;
    private hdmaBlocksRemaining = 0;
    private hdmaActive = false;
    private joypSelect = 0x00;
    private joypadState: Record<JoypadButton, boolean> = {
        right: false,
        left: false,
        up: false,
        down: false,
        a: false,
        b: false,
        select: false,
        start: false,
    };

    constructor(size: number) {
        this.memory = new Uint8Array(size);
    }

    readByte(address: number): number {
        if (address >= 0x0000 && address <= 0x7FFF) {
            return this.readCartridgeRom(address);
        }

        if (address >= 0x8000 && address <= 0x9FFF) {
            return this.readVideoRam(address);
        }

        if (address >= 0xA000 && address <= 0xBFFF) {
            return this.readCartridgeRam(address);
        }

        if (address >= 0xC000 && address <= 0xFDFF) {
            return this.readWorkRam(address);
        }

        if (address < 0 || address >= this.memory.length) {
            throw new Error(`Memory read out of bounds at address 0x${address.toString(16)}`);
        }

        if (address === 0xFF00) {
            return this.getJoypadValue();
        }

        if (address === 0xFF4F) {
            return this.cgbMode ? (0xFE | this.vramBank) : 0xFF;
        }

        if (address === 0xFF68) {
            return this.cgbMode ? ((this.bgPaletteAutoIncrement ? 0x80 : 0x00) | (this.bgPaletteIndex & 0x3F)) : 0xFF;
        }

        if (address === 0xFF69) {
            return this.cgbMode ? this.cgbBgPaletteRam[this.bgPaletteIndex & 0x3F] : 0xFF;
        }

        if (address === 0xFF6A) {
            return this.cgbMode ? ((this.objPaletteAutoIncrement ? 0x80 : 0x00) | (this.objPaletteIndex & 0x3F)) : 0xFF;
        }

        if (address === 0xFF6B) {
            return this.cgbMode ? this.cgbObjPaletteRam[this.objPaletteIndex & 0x3F] : 0xFF;
        }

        if (address === 0xFF44) {
            return this.ly;
        }

        if (address === 0xFF4D) {
            return this.hasActiveCgbFeatures() ? this.getKey1Value() : 0xFF;
        }

        if (address >= 0xFF51 && address <= 0xFF54) {
            return this.hasActiveCgbFeatures() ? this.memory[address] : 0xFF;
        }

        if (address === 0xFF55) {
            if (!this.hasActiveCgbFeatures()) {
                return 0xFF;
            }

            return this.hdmaActive
                ? ((this.hdmaBlocksRemaining - 1) & 0x7F)
                : (0x80 | ((Math.max(this.hdmaBlocksRemaining, 1) - 1) & 0x7F));
        }

        if (address === 0xFF70) {
            return this.hasActiveCgbFeatures() ? (0xF8 | this.wramBank) : 0xFF;
        }

        return this.memory[address];
    }

    peekByte(address: number): number {
        if (address >= 0x0000 && address <= 0x7FFF) {
            return this.readCartridgeRom(address);
        }

        if (address >= 0x8000 && address <= 0x9FFF) {
            return this.readVideoRam(address);
        }

        if (address >= 0xA000 && address <= 0xBFFF) {
            return this.readCartridgeRam(address);
        }

        if (address >= 0xC000 && address <= 0xFDFF) {
            return this.readWorkRam(address);
        }

        if (address < 0 || address >= this.memory.length) {
            throw new Error(`Memory peek out of bounds at address 0x${address.toString(16)}`);
        }

        if (address === 0xFF00) {
            return this.getJoypadValue();
        }

        if (address === 0xFF4F) {
            return this.cgbMode ? (0xFE | this.vramBank) : 0xFF;
        }

        if (address === 0xFF68) {
            return this.cgbMode ? ((this.bgPaletteAutoIncrement ? 0x80 : 0x00) | (this.bgPaletteIndex & 0x3F)) : 0xFF;
        }

        if (address === 0xFF69) {
            return this.cgbMode ? this.cgbBgPaletteRam[this.bgPaletteIndex & 0x3F] : 0xFF;
        }

        if (address === 0xFF6A) {
            return this.cgbMode ? ((this.objPaletteAutoIncrement ? 0x80 : 0x00) | (this.objPaletteIndex & 0x3F)) : 0xFF;
        }

        if (address === 0xFF6B) {
            return this.cgbMode ? this.cgbObjPaletteRam[this.objPaletteIndex & 0x3F] : 0xFF;
        }

        if (address === 0xFF44) {
            return this.ly;
        }

        if (address === 0xFF4D) {
            return this.hasActiveCgbFeatures() ? this.getKey1Value() : 0xFF;
        }

        if (address >= 0xFF51 && address <= 0xFF54) {
            return this.hasActiveCgbFeatures() ? this.memory[address] : 0xFF;
        }

        if (address === 0xFF55) {
            if (!this.hasActiveCgbFeatures()) {
                return 0xFF;
            }

            return this.hdmaActive
                ? ((this.hdmaBlocksRemaining - 1) & 0x7F)
                : (0x80 | ((Math.max(this.hdmaBlocksRemaining, 1) - 1) & 0x7F));
        }

        if (address === 0xFF70) {
            return this.hasActiveCgbFeatures() ? (0xF8 | this.wramBank) : 0xFF;
        }

        return this.memory[address];
    }

    writeByte(address: number, value: number) {
        if (address >= 0x0000 && address <= 0x7FFF) {
            this.writeCartridgeControl(address, value & 0xFF);
            return;
        }

        if (address >= 0x8000 && address <= 0x9FFF) {
            this.writeVideoRam(address, value & 0xFF);
            return;
        }

        if (address >= 0xA000 && address <= 0xBFFF) {
            this.writeCartridgeRam(address, value & 0xFF);
            return;
        }

        if (address >= 0xC000 && address <= 0xFDFF) {
            this.writeWorkRam(address, value & 0xFF);
            return;
        }

        if (address < 0 || address >= this.memory.length) {
            throw new Error(`Memory write out of bounds at address 0x${address.toString(16)}`);
        }

        if (address === 0xFF00) {
            this.joypSelect = value & 0x30;
            this.memory[address] = this.getJoypadValue();
            return;
        }

        if (address === 0xFF46) {
            this.memory[address] = value & 0xFF;
            this.performDmaTransfer(value & 0xFF);
            return;
        }

        if (address === 0xFF4D) {
            if (this.hasActiveCgbFeatures()) {
                this.speedSwitchArmed = (value & 0x01) !== 0;
                this.memory[address] = this.getKey1Value();
            }
            return;
        }

        if (address === 0xFF41) {
            const current = this.memory[address] ?? 0;
            this.memory[address] = ((value & 0xF8) | (current & 0x07)) & 0xFF;
            this.updateStatRegister();
            return;
        }

        if (address === 0xFF4F) {
            if (!this.cgbMode) {
                this.memory[address] = 0xFF;
                return;
            }
            this.vramBank = value & 0x01;
            this.memory[address] = 0xFE | this.vramBank;
            return;
        }

        if (address === 0xFF68) {
            if (!this.cgbMode) {
                this.memory[address] = 0xFF;
                return;
            }
            this.bgPaletteIndex = value & 0x3F;
            this.bgPaletteAutoIncrement = (value & 0x80) !== 0;
            this.memory[address] = (this.bgPaletteAutoIncrement ? 0x80 : 0x00) | this.bgPaletteIndex;
            return;
        }

        if (address === 0xFF69) {
            if (!this.cgbMode) {
                this.memory[address] = 0xFF;
                return;
            }
            this.cgbBgPaletteRam[this.bgPaletteIndex & 0x3F] = value & 0xFF;
            if (this.bgPaletteAutoIncrement) {
                this.bgPaletteIndex = (this.bgPaletteIndex + 1) & 0x3F;
            }
            this.memory[0xFF68] = (this.bgPaletteAutoIncrement ? 0x80 : 0x00) | this.bgPaletteIndex;
            return;
        }

        if (address === 0xFF6A) {
            if (!this.cgbMode) {
                this.memory[address] = 0xFF;
                return;
            }
            this.objPaletteIndex = value & 0x3F;
            this.objPaletteAutoIncrement = (value & 0x80) !== 0;
            this.memory[address] = (this.objPaletteAutoIncrement ? 0x80 : 0x00) | this.objPaletteIndex;
            return;
        }

        if (address === 0xFF6B) {
            if (!this.cgbMode) {
                this.memory[address] = 0xFF;
                return;
            }
            this.cgbObjPaletteRam[this.objPaletteIndex & 0x3F] = value & 0xFF;
            if (this.objPaletteAutoIncrement) {
                this.objPaletteIndex = (this.objPaletteIndex + 1) & 0x3F;
            }
            this.memory[0xFF6A] = (this.objPaletteAutoIncrement ? 0x80 : 0x00) | this.objPaletteIndex;
            return;
        }

        if (address >= 0xFF51 && address <= 0xFF55) {
            this.writeHdmaRegister(address, value & 0xFF);
            return;
        }

        if (address === 0xFF70) {
            if (this.hasActiveCgbFeatures()) {
                this.wramBank = value & 0x07;
                if (this.wramBank === 0) {
                    this.wramBank = 1;
                }
                this.memory[address] = 0xF8 | this.wramBank;
            }
            return;
        }

        if (address >= 0xFF10 && address <= 0xFF3F) {
            this.memory[address] = value & 0xFF;
            this.handleAudioRegisterWrite(address, value & 0xFF);
            return;
        }

        if (address === 0xFF44) {
            this.ly = 0;
            this.memory[address] = 0;
            this.lcdCycleCounter = 0;
            this.updateStatRegister();
            return;
        }

        if (address === 0xFF45) {
            this.memory[address] = value & 0xFF;
            this.updateStatRegister();
            return;
        }

        this.memory[address] = value & 0xFF; // Ensure only the lower 8 bits are stored
    }

    loadBytes(startAddress: number, data: Uint8Array) {
        if (startAddress < 0 || startAddress + data.length > this.memory.length) {
            throw new Error(
                `Memory load out of bounds from address 0x${startAddress.toString(16)} with length ${data.length}`,
            );
        }

        this.memory.set(data, startAddress);
    }

    loadCartridge(romData: Uint8Array) {
        this.cartridgeRom = romData;
        this.cartridgeType = romData[0x0147] ?? 0x00;
        this.cgbFlag = romData[0x0143] ?? 0x00;
        this.cgbMode = (this.cgbFlag & 0x80) !== 0;
        this.mbcType = this.resolveMbcType(this.cartridgeType);
        this.romBankCount = this.resolveCartridgeRomBankCount(romData[0x0148] ?? 0x00, romData.length);
        this.cartridgeRam = new Uint8Array(this.resolveCartridgeRamSize(romData[0x0149] ?? 0x00));
        this.ramBankCount = this.resolveCartridgeRamBankCount(this.cartridgeRam.length);
        this.currentRomBank = 1;
        this.currentRamBank = 0;
        this.ramEnabled = this.mbcType === "rom-only" && this.cartridgeRam.length > 0;
        this.mbc1BankingMode = 0;
        this.mbc3RtcRegisters.fill(0);
        this.mbc3RtcLatchedRegisters.fill(0);
        this.mbc3RtcSelectedRegister = null;
        this.mbc3RtcLatchPrimed = false;
        this.mbc3RtcLastUpdateMs = Date.now();
        this.audioChannelActive = [false, false, false, false];
        this.vramBank = 0;
        this.cgbVramBank1.fill(0);
        this.cgbBgPaletteRam.fill(0);
        this.cgbObjPaletteRam.fill(0);
        this.bgPaletteIndex = 0;
        this.bgPaletteAutoIncrement = false;
        this.objPaletteIndex = 0;
        this.objPaletteAutoIncrement = false;
        this.cgbWramBanks.fill(0);
        this.wramBank = 1;
        this.doubleSpeedMode = false;
        this.speedSwitchArmed = false;
        this.hdmaSource = 0x0000;
        this.hdmaDestination = 0x8000;
        this.hdmaBlocksRemaining = 0;
        this.hdmaActive = false;
        this.dmgCompatibilityColorMode = false;
        this.dmgCompatibilityPalette = this.resolveDmgCompatibilityPalette(this.getCartridgeTitle());
    }

    readWord(address: number): number {
        const lowByte = this.readByte(address);
        const highByte = this.readByte((address + 1) & 0xFFFF);
        return (highByte << 8) | lowByte;
    }

    writeWord(address: number, value: number) {
        this.writeByte(address, value & 0xFF); // Write low byte
        this.writeByte((address + 1) & 0xFFFF, (value >> 8) & 0xFF); // Write high byte
    }

    initializePostBootState(hardwareModel: HardwareModel = "dmg") {
        this.hardwareModel = hardwareModel;
        const ioDefaults: Array<[number, number]> = [
            [0xFF00, 0xCF], // P1/JOYP
            [0xFF01, 0x00], // SB
            [0xFF02, 0x7E], // SC
            [0xFF04, 0xAB], // DIV
            [0xFF05, 0x00], // TIMA
            [0xFF06, 0x00], // TMA
            [0xFF07, 0x00], // TAC
            [0xFF0F, 0xE1], // IF
            [0xFF10, 0x80], // NR10
            [0xFF11, 0xBF], // NR11
            [0xFF12, 0xF3], // NR12
            [0xFF13, 0xFF], // NR13
            [0xFF14, 0xBF], // NR14
            [0xFF16, 0x3F], // NR21
            [0xFF17, 0x00], // NR22
            [0xFF18, 0xFF], // NR23
            [0xFF19, 0xBF], // NR24
            [0xFF1A, 0x7F], // NR30
            [0xFF1B, 0xFF], // NR31
            [0xFF1C, 0x9F], // NR32
            [0xFF1D, 0xFF], // NR33
            [0xFF1E, 0xBF], // NR34
            [0xFF20, 0xFF], // NR41
            [0xFF21, 0x00], // NR42
            [0xFF22, 0x00], // NR43
            [0xFF23, 0xBF], // NR44
            [0xFF24, 0x77], // NR50
            [0xFF25, 0xF3], // NR51
            [0xFF26, 0xF1], // NR52
            [0xFF40, 0x91], // LCDC
            [0xFF41, 0x85], // STAT
            [0xFF42, 0x00], // SCY
            [0xFF43, 0x00], // SCX
            [0xFF45, 0x00], // LYC
            [0xFF47, 0xFC], // BGP
            [0xFF48, 0xFF], // OBP0
            [0xFF49, 0xFF], // OBP1
            [0xFF4A, 0x00], // WY
            [0xFF4B, 0x00], // WX
            [0xFF4F, 0xFE], // VBK
            [0xFF50, 0x01], // Boot ROM disabled
            [0xFF4D, 0x7E], // KEY1
            [0xFF51, 0xFF], // HDMA1
            [0xFF52, 0xFF], // HDMA2
            [0xFF53, 0xFF], // HDMA3
            [0xFF54, 0xFF], // HDMA4
            [0xFF55, 0xFF], // HDMA5
            [0xFF68, 0x00], // BCPS
            [0xFF69, 0x00], // BCPD
            [0xFF6A, 0x00], // OCPS
            [0xFF6B, 0x00], // OCPD
            [0xFF70, 0xF9], // SVBK
            [0xFFFF, 0x00], // IE
        ];

        for (const [address, value] of ioDefaults) {
            this.writeByte(address, value);
        }

        this.ly = 0;
        this.divCycleCounter = 0;
        this.lcdCycleCounter = 0;
        this.joypSelect = this.memory[0xFF00] & 0x30;
        this.memory[0xFF00] = this.getJoypadValue();
        this.memory[0xFF46] = 0xFF;
        this.memory[0xFF44] = 0x00;
        this.audioChannelActive = [false, false, false, false];
        this.vramBank = 0;
        this.wramBank = 1;
        this.doubleSpeedMode = false;
        this.speedSwitchArmed = false;
        this.hdmaSource = 0x0000;
        this.hdmaDestination = 0x8000;
        this.hdmaBlocksRemaining = 0;
        this.hdmaActive = false;
        this.bgPaletteIndex = 0;
        this.bgPaletteAutoIncrement = false;
        this.objPaletteIndex = 0;
        this.objPaletteAutoIncrement = false;
        this.dmgCompatibilityColorMode = hardwareModel === "cgb" && !this.cgbMode;
        this.dmgCompatibilityPalette = this.resolveDmgCompatibilityPalette(this.getCartridgeTitle());
        this.memory[0xFF4F] = 0xFE;
        this.memory[0xFF4D] = this.getKey1Value();
        this.memory[0xFF55] = 0xFF;
        this.memory[0xFF68] = 0x00;
        this.memory[0xFF6A] = 0x00;
        this.memory[0xFF70] = 0xF9;
        this.updateStatRegister();
        this.refreshAudioStatusRegister();
    }

    initializeDmgPostBootState() {
        this.initializePostBootState("dmg");
    }

    initializeCgbPostBootState() {
        this.initializePostBootState("cgb");
    }

    saveState(): MemoryStateSnapshot {
        return {
            memory: Array.from(this.memory),
            cgbWramBanks: Array.from(this.cgbWramBanks),
            cartridgeRam: Array.from(this.cartridgeRam),
            cgbVramBank1: Array.from(this.cgbVramBank1),
            cgbBgPaletteRam: Array.from(this.cgbBgPaletteRam),
            cgbObjPaletteRam: Array.from(this.cgbObjPaletteRam),
            cartridgeType: this.cartridgeType,
            cgbFlag: this.cgbFlag,
            cgbMode: this.cgbMode,
            romBankCount: this.romBankCount,
            ramBankCount: this.ramBankCount,
            currentRomBank: this.currentRomBank,
            currentRamBank: this.currentRamBank,
            ramEnabled: this.ramEnabled,
            mbcType: this.mbcType,
            mbc1BankingMode: this.mbc1BankingMode,
            mbc3RtcRegisters: Array.from(this.mbc3RtcRegisters),
            mbc3RtcLatchedRegisters: Array.from(this.mbc3RtcLatchedRegisters),
            mbc3RtcSelectedRegister: this.mbc3RtcSelectedRegister,
            mbc3RtcLatchPrimed: this.mbc3RtcLatchPrimed,
            mbc3RtcLastUpdateMs: this.mbc3RtcLastUpdateMs,
            audioChannelActive: [...this.audioChannelActive],
            vramBank: this.vramBank,
            bgPaletteIndex: this.bgPaletteIndex,
            bgPaletteAutoIncrement: this.bgPaletteAutoIncrement,
            objPaletteIndex: this.objPaletteIndex,
            objPaletteAutoIncrement: this.objPaletteAutoIncrement,
            hardwareModel: this.hardwareModel,
            dmgCompatibilityColorMode: this.dmgCompatibilityColorMode,
            dmgCompatibilityPaletteName: this.dmgCompatibilityPalette.name,
            wramBank: this.wramBank,
            doubleSpeedMode: this.doubleSpeedMode,
            speedSwitchArmed: this.speedSwitchArmed,
            hdmaSource: this.hdmaSource,
            hdmaDestination: this.hdmaDestination,
            hdmaBlocksRemaining: this.hdmaBlocksRemaining,
            hdmaActive: this.hdmaActive,
            ly: this.ly,
            divCycleCounter: this.divCycleCounter,
            lcdCycleCounter: this.lcdCycleCounter,
            joypSelect: this.joypSelect,
            joypadState: { ...this.joypadState },
        };
    }

    loadState(snapshot: MemoryStateSnapshot) {
        this.memory = Uint8Array.from(snapshot.memory);
        this.cgbWramBanks = Uint8Array.from(snapshot.cgbWramBanks ?? new Array(0x7000).fill(0));
        this.cartridgeRam = Uint8Array.from(snapshot.cartridgeRam);
        this.cgbVramBank1 = Uint8Array.from(snapshot.cgbVramBank1 ?? new Array(0x2000).fill(0));
        this.cgbBgPaletteRam = Uint8Array.from(snapshot.cgbBgPaletteRam ?? new Array(0x40).fill(0));
        this.cgbObjPaletteRam = Uint8Array.from(snapshot.cgbObjPaletteRam ?? new Array(0x40).fill(0));
        this.cartridgeType = snapshot.cartridgeType ?? 0x00;
        this.cgbFlag = snapshot.cgbFlag ?? 0x00;
        this.cgbMode = snapshot.cgbMode ?? ((this.cgbFlag & 0x80) !== 0);
        this.romBankCount = snapshot.romBankCount ?? 1;
        this.ramBankCount = this.resolveCartridgeRamBankCount(this.cartridgeRam.length);
        this.currentRomBank = snapshot.currentRomBank;
        this.currentRamBank = snapshot.currentRamBank;
        this.mbcType = snapshot.mbcType;
        this.ramEnabled = this.mbcType === "rom-only"
            ? this.cartridgeRam.length > 0
            : snapshot.ramEnabled;
        this.mbc1BankingMode = snapshot.mbc1BankingMode ?? 0;
        this.mbc3RtcRegisters = Uint8Array.from(snapshot.mbc3RtcRegisters ?? [0, 0, 0, 0, 0]);
        this.mbc3RtcLatchedRegisters = Uint8Array.from(snapshot.mbc3RtcLatchedRegisters ?? [0, 0, 0, 0, 0]);
        this.mbc3RtcSelectedRegister = snapshot.mbc3RtcSelectedRegister ?? null;
        this.mbc3RtcLatchPrimed = snapshot.mbc3RtcLatchPrimed ?? false;
        this.mbc3RtcLastUpdateMs = snapshot.mbc3RtcLastUpdateMs ?? Date.now();
        this.audioChannelActive = snapshot.audioChannelActive ?? [false, false, false, false];
        this.vramBank = snapshot.vramBank ?? 0;
        this.bgPaletteIndex = snapshot.bgPaletteIndex ?? 0;
        this.bgPaletteAutoIncrement = snapshot.bgPaletteAutoIncrement ?? false;
        this.objPaletteIndex = snapshot.objPaletteIndex ?? 0;
        this.objPaletteAutoIncrement = snapshot.objPaletteAutoIncrement ?? false;
        this.hardwareModel = snapshot.hardwareModel ?? "dmg";
        this.dmgCompatibilityColorMode = snapshot.dmgCompatibilityColorMode ?? (this.hardwareModel === "cgb" && !this.cgbMode);
        this.dmgCompatibilityPalette = this.resolveDmgCompatibilityPalette(this.getCartridgeTitle(), snapshot.dmgCompatibilityPaletteName);
        this.wramBank = snapshot.wramBank ?? 1;
        this.doubleSpeedMode = snapshot.doubleSpeedMode ?? false;
        this.speedSwitchArmed = snapshot.speedSwitchArmed ?? false;
        this.hdmaSource = snapshot.hdmaSource ?? 0x0000;
        this.hdmaDestination = snapshot.hdmaDestination ?? 0x8000;
        this.hdmaBlocksRemaining = snapshot.hdmaBlocksRemaining ?? 0;
        this.hdmaActive = snapshot.hdmaActive ?? false;
        this.ly = snapshot.ly;
        this.divCycleCounter = snapshot.divCycleCounter;
        this.lcdCycleCounter = snapshot.lcdCycleCounter;
        this.joypSelect = snapshot.joypSelect;
        this.joypadState = { ...snapshot.joypadState };
        this.memory[0xFF4F] = 0xFE | this.vramBank;
        this.memory[0xFF4D] = this.getKey1Value();
        this.memory[0xFF55] = this.hdmaActive
            ? ((this.hdmaBlocksRemaining - 1) & 0x7F)
            : (0x80 | ((Math.max(this.hdmaBlocksRemaining, 1) - 1) & 0x7F));
        this.memory[0xFF68] = (this.bgPaletteAutoIncrement ? 0x80 : 0x00) | this.bgPaletteIndex;
        this.memory[0xFF6A] = (this.objPaletteAutoIncrement ? 0x80 : 0x00) | this.objPaletteIndex;
        this.memory[0xFF70] = 0xF8 | this.wramBank;
        this.updateStatRegister();
        this.refreshAudioStatusRegister();
    }

    getCartridgeInfo(): CartridgeInfo {
        return {
            title: this.getCartridgeTitle(),
            typeCode: this.cartridgeType,
            typeName: this.resolveCartridgeTypeName(this.cartridgeType),
            mapper: this.mbcType,
            romBanks: this.romBankCount,
            ramBanks: this.ramBankCount,
            hasBattery: this.hasBatteryBackedRam(),
            hasRtc: this.supportsMbc3Rtc(),
            hasRumble: this.hasMbc5Rumble(),
            cgbSupported: this.isCgbSupported(),
            cgbOnly: this.isCgbOnly(),
        };
    }

    isCgbSupported(): boolean {
        return (this.cgbFlag & 0x80) !== 0;
    }

    isCgbOnly(): boolean {
        return this.cgbFlag === 0xC0;
    }

    isCgbModeEnabled(): boolean {
        return this.cgbMode;
    }

    isDoubleSpeedEnabled(): boolean {
        return this.doubleSpeedMode;
    }

    getEffectiveSystemCycles(cycles: number): number {
        if (!this.doubleSpeedMode) {
            return cycles;
        }

        return Math.max(1, Math.floor(cycles / 2));
    }

    handleStopModeSwitch(): boolean {
        if (!this.hasActiveCgbFeatures() || !this.speedSwitchArmed) {
            return false;
        }

        this.doubleSpeedMode = !this.doubleSpeedMode;
        this.speedSwitchArmed = false;
        this.memory[0xFF4D] = this.getKey1Value();
        return true;
    }

    isDmgCompatibilityColorModeEnabled(): boolean {
        return this.dmgCompatibilityColorMode;
    }

    getDmgCompatibilityPaletteName(): string {
        return this.dmgCompatibilityPalette.name;
    }

    getDmgCompatibilityColor(kind: "bg" | "obj0" | "obj1", shadeIndex: number): [number, number, number, number] {
        const palette = this.dmgCompatibilityPalette[kind];
        return palette[shadeIndex & 0x03];
    }

    peekVideoRamByte(address: number, bank: 0 | 1 = 0): number {
        const vramOffset = address - 0x8000;
        if (vramOffset < 0 || vramOffset >= 0x2000) {
            throw new Error(`VRAM peek out of bounds at address 0x${address.toString(16)}`);
        }

        if (!this.cgbMode || bank === 0) {
            return this.memory[address];
        }

        return this.cgbVramBank1[vramOffset];
    }

    getCgbPaletteColor(kind: "bg" | "obj", paletteIndex: number, colorIndex: number): [number, number, number, number] {
        const paletteRam = kind === "bg" ? this.cgbBgPaletteRam : this.cgbObjPaletteRam;
        const normalizedPaletteIndex = paletteIndex & 0x07;
        const normalizedColorIndex = colorIndex & 0x03;
        const colorOffset = (normalizedPaletteIndex * 8) + (normalizedColorIndex * 2);
        const lowByte = paletteRam[colorOffset] ?? 0;
        const highByte = paletteRam[colorOffset + 1] ?? 0;
        const bgr15 = lowByte | (highByte << 8);

        return this.decodeCgbColor(bgr15);
    }

    getAudioState(): AudioState {
        const nr50 = this.memory[0xFF24] ?? 0;
        const nr51 = this.memory[0xFF25] ?? 0;
        const masterEnabled = this.isAudioMasterEnabled();

        return {
            masterEnabled,
            leftVolume: ((nr50 >> 4) & 0x07) / 7,
            rightVolume: (nr50 & 0x07) / 7,
            channels: [
                this.getSquareAudioChannelState(0, 1, 0xFF11, 0xFF12, 0xFF13, 0xFF14, nr51),
                this.getSquareAudioChannelState(1, 2, 0xFF16, 0xFF17, 0xFF18, 0xFF19, nr51),
                this.getWaveAudioChannelState(nr51),
                this.getNoiseAudioChannelState(nr51),
            ].map((channel) => ({
                ...channel,
                enabled: masterEnabled && channel.enabled,
            })),
        };
    }

    tick(cycles: number) {
        if (cycles <= 0) {
            return;
        }

        const effectiveCycles = this.doubleSpeedMode ? Math.max(1, Math.floor(cycles / 2)) : cycles;

        this.divCycleCounter += effectiveCycles;
        while (this.divCycleCounter >= 256) {
            this.divCycleCounter -= 256;
            this.memory[0xFF04] = (this.memory[0xFF04] + 1) & 0xFF;
        }

        const lcdEnabled = (this.memory[0xFF40] & 0x80) !== 0;
        if (!lcdEnabled) {
            this.ly = 0;
            this.lcdCycleCounter = 0;
            this.memory[0xFF44] = 0;
            this.updateStatRegister();
            return;
        }

        let remainingCycles = effectiveCycles;
        while (remainingCycles > 0) {
            const previousMode = this.memory[0xFF41] & 0x03;
            const previousCoincidence = (this.memory[0xFF41] & 0x04) !== 0;
            const cyclesUntilBoundary = this.getCyclesUntilNextPpuBoundary();
            const stepCycles = Math.min(remainingCycles, cyclesUntilBoundary);

            this.lcdCycleCounter += stepCycles;
            remainingCycles -= stepCycles;

            if (this.lcdCycleCounter >= 456) {
                this.lcdCycleCounter -= 456;
                this.ly = (this.ly + 1) % 154;
                this.memory[0xFF44] = this.ly;

                if (this.ly === 144) {
                    this.requestInterrupt(0x01);
                }
            }

            this.updateStatRegister(previousMode, previousCoincidence);
        }
    }

    requestInterrupt(mask: number) {
        const currentIf = this.memory[0xFF0F] ?? 0;
        this.memory[0xFF0F] = (currentIf | (mask & 0x1F) | 0xE0) & 0xFF;
    }

    setJoypadButton(button: JoypadButton, pressed: boolean) {
        const wasPressed = this.joypadState[button];
        this.joypadState[button] = pressed;
        this.memory[0xFF00] = this.getJoypadValue();

        if (!wasPressed && pressed) {
            this.requestInterrupt(0x10);
        }
    }

    private getJoypadValue(): number {
        let lowerNibble = 0x0F;
        const selectDirections = (this.joypSelect & 0x10) === 0;
        const selectButtons = (this.joypSelect & 0x20) === 0;

        if (selectDirections) {
            if (this.joypadState.right) {
                lowerNibble &= ~0x01;
            }
            if (this.joypadState.left) {
                lowerNibble &= ~0x02;
            }
            if (this.joypadState.up) {
                lowerNibble &= ~0x04;
            }
            if (this.joypadState.down) {
                lowerNibble &= ~0x08;
            }
        }

        if (selectButtons) {
            if (this.joypadState.a) {
                lowerNibble &= ~0x01;
            }
            if (this.joypadState.b) {
                lowerNibble &= ~0x02;
            }
            if (this.joypadState.select) {
                lowerNibble &= ~0x04;
            }
            if (this.joypadState.start) {
                lowerNibble &= ~0x08;
            }
        }

        return (0xC0 | this.joypSelect | lowerNibble) & 0xFF;
    }

    private readWorkRam(address: number): number {
        if (address >= 0xE000 && address <= 0xFDFF) {
            return this.readWorkRam(address - 0x2000);
        }

        if (address >= 0xC000 && address <= 0xCFFF) {
            return this.memory[address];
        }

        if (address >= 0xD000 && address <= 0xDFFF) {
            const offset = ((this.wramBank - 1) * 0x1000) + (address - 0xD000);
            return this.cgbWramBanks[offset];
        }

        return this.memory[address];
    }

    private writeWorkRam(address: number, value: number) {
        if (address >= 0xE000 && address <= 0xFDFF) {
            this.writeWorkRam(address - 0x2000, value);
            return;
        }

        if (address >= 0xC000 && address <= 0xCFFF) {
            this.memory[address] = value;
            return;
        }

        if (address >= 0xD000 && address <= 0xDFFF) {
            const offset = ((this.wramBank - 1) * 0x1000) + (address - 0xD000);
            this.cgbWramBanks[offset] = value;
            return;
        }

        this.memory[address] = value;
    }

    private getKey1Value(): number {
        return 0x7E | (this.doubleSpeedMode ? 0x80 : 0x00) | (this.speedSwitchArmed ? 0x01 : 0x00);
    }

    private hasActiveCgbFeatures(): boolean {
        return this.hardwareModel === "cgb" && this.cgbMode;
    }

    private getCyclesUntilNextPpuBoundary(): number {
        if ((this.memory[0xFF40] & 0x80) === 0) {
            return 456;
        }

        if (this.ly >= 144) {
            return 456 - this.lcdCycleCounter;
        }

        if (this.lcdCycleCounter < 80) {
            return 80 - this.lcdCycleCounter;
        }

        if (this.lcdCycleCounter < 252) {
            return 252 - this.lcdCycleCounter;
        }

        return 456 - this.lcdCycleCounter;
    }

    private getCurrentPpuMode(): number {
        if ((this.memory[0xFF40] & 0x80) === 0) {
            return 0;
        }

        if (this.ly >= 144) {
            return 1;
        }

        if (this.lcdCycleCounter < 80) {
            return 2;
        }

        if (this.lcdCycleCounter < 252) {
            return 3;
        }

        return 0;
    }

    private updateStatRegister(previousMode?: number, previousCoincidence?: boolean) {
        const oldStat = this.memory[0xFF41] ?? 0;
        const mode = this.getCurrentPpuMode();
        const coincidence = this.ly === (this.memory[0xFF45] ?? 0);
        const stat = (oldStat & 0xF8) | (coincidence ? 0x04 : 0x00) | mode;

        this.memory[0xFF41] = stat & 0xFF;

        const priorMode = previousMode ?? (oldStat & 0x03);
        const priorCoincidence = previousCoincidence ?? ((oldStat & 0x04) !== 0);

        if (mode !== priorMode) {
            if (mode === 0) {
                if (this.hdmaActive && this.ly < 144) {
                    this.performHdmaBlock();
                }

                if ((stat & 0x08) !== 0) {
                    this.requestInterrupt(0x02);
                }
            } else if (mode === 1 && (stat & 0x10) !== 0) {
                this.requestInterrupt(0x02);
            } else if (mode === 2 && (stat & 0x20) !== 0) {
                this.requestInterrupt(0x02);
            }
        }

        if (coincidence && !priorCoincidence && (stat & 0x40) !== 0) {
            this.requestInterrupt(0x02);
        }
    }

    private writeHdmaRegister(address: number, value: number) {
        if (!this.hasActiveCgbFeatures()) {
            this.memory[address] = 0xFF;
            return;
        }

        if (address === 0xFF51) {
            this.memory[address] = value;
            this.hdmaSource = ((value & 0xFF) << 8) | (this.hdmaSource & 0x00FF);
            return;
        }

        if (address === 0xFF52) {
            this.memory[address] = value & 0xF0;
            this.hdmaSource = (this.hdmaSource & 0xFF00) | (value & 0xF0);
            return;
        }

        if (address === 0xFF53) {
            this.memory[address] = value & 0x1F;
            this.hdmaDestination = 0x8000 | ((value & 0x1F) << 8) | (this.hdmaDestination & 0x00F0);
            return;
        }

        if (address === 0xFF54) {
            this.memory[address] = value & 0xF0;
            this.hdmaDestination = (this.hdmaDestination & 0x9F00) | (value & 0xF0);
            return;
        }

        if (this.hdmaActive && (value & 0x80) === 0) {
            this.hdmaActive = false;
            this.memory[address] = 0x80 | ((this.hdmaBlocksRemaining - 1) & 0x7F);
            return;
        }

        this.hdmaBlocksRemaining = (value & 0x7F) + 1;

        if ((value & 0x80) === 0) {
            while (this.hdmaBlocksRemaining > 0) {
                this.performHdmaBlock();
            }
            this.hdmaActive = false;
            this.memory[address] = 0xFF;
            return;
        }

        this.hdmaActive = true;
        this.memory[address] = (this.hdmaBlocksRemaining - 1) & 0x7F;
    }

    private performHdmaBlock() {
        if (this.hdmaBlocksRemaining <= 0) {
            this.hdmaActive = false;
            this.memory[0xFF55] = 0xFF;
            return;
        }

        for (let offset = 0; offset < 0x10; offset += 1) {
            const source = (this.hdmaSource + offset) & 0xFFFF;
            const destination = 0x8000 | ((this.hdmaDestination + offset) & 0x1FFF);
            this.writeVideoRam(destination, this.peekByte(source));
        }

        this.hdmaSource = (this.hdmaSource + 0x10) & 0xFFF0;
        this.hdmaDestination = 0x8000 | ((this.hdmaDestination + 0x10) & 0x1FF0);
        this.hdmaBlocksRemaining -= 1;

        if (this.hdmaBlocksRemaining <= 0) {
            this.hdmaActive = false;
            this.memory[0xFF55] = 0xFF;
        } else {
            this.memory[0xFF55] = (this.hdmaBlocksRemaining - 1) & 0x7F;
        }
    }

    private readVideoRam(address: number): number {
        if (!this.cgbMode) {
            return this.memory[address];
        }

        return this.peekVideoRamByte(address, this.vramBank as 0 | 1);
    }

    private writeVideoRam(address: number, value: number) {
        const vramOffset = address - 0x8000;
        if (!this.cgbMode || this.vramBank === 0) {
            this.memory[address] = value;
            return;
        }

        this.cgbVramBank1[vramOffset] = value;
    }

    private decodeCgbColor(bgr15: number): [number, number, number, number] {
        const red5 = bgr15 & 0x1F;
        const green5 = (bgr15 >> 5) & 0x1F;
        const blue5 = (bgr15 >> 10) & 0x1F;

        return [
            Math.round((red5 / 31) * 255),
            Math.round((green5 / 31) * 255),
            Math.round((blue5 / 31) * 255),
            255,
        ];
    }

    private performDmaTransfer(page: number) {
        const sourceBaseAddress = (page & 0xFF) << 8;

        for (let offset = 0; offset < 0xA0; offset += 1) {
            this.memory[0xFE00 + offset] = this.peekByte((sourceBaseAddress + offset) & 0xFFFF);
        }
    }

    private readCartridgeRom(address: number): number {
        if (!this.cartridgeRom) {
            return this.memory[address];
        }

        if (this.mbcType === "mbc1") {
            const bank = this.resolveMbc1RomBank(address);
            const romOffset = (bank * 0x4000) + (address & 0x3FFF);
            return this.cartridgeRom[romOffset] ?? 0xFF;
        }

        if (address < 0x4000) {
            return this.cartridgeRom[address] ?? 0xFF;
        }

        const bankOffset = this.currentRomBank * 0x4000;
        const romOffset = bankOffset + (address - 0x4000);

        return this.cartridgeRom[romOffset] ?? 0xFF;
    }

    private readCartridgeRam(address: number): number {
        if (!this.isCartridgeRamAccessible()) {
            return 0xFF;
        }

        if (this.mbcType === "mbc3" && this.mbc3RtcSelectedRegister !== null) {
            this.updateMbc3Rtc();
            return this.mbc3RtcLatchedRegisters[this.mbc3RtcSelectedRegister - 0x08] ?? 0xFF;
        }

        if (this.cartridgeRam.length === 0) {
            return 0xFF;
        }

        const ramBank = this.resolveActiveRamBank();
        const ramOffset = (ramBank * 0x2000) + (address - 0xA000);
        return this.cartridgeRam[ramOffset] ?? 0xFF;
    }

    private writeCartridgeRam(address: number, value: number) {
        if (this.mbcType === "mbc3" && this.mbc3RtcSelectedRegister !== null) {
            if (!this.isCartridgeRamAccessible()) {
                return;
            }

            this.updateMbc3Rtc();
            this.writeMbc3RtcRegister(this.mbc3RtcSelectedRegister, value);
            return;
        }

        if (!this.isCartridgeRamAccessible() || this.cartridgeRam.length === 0) {
            return;
        }

        const ramBank = this.resolveActiveRamBank();
        const ramOffset = (ramBank * 0x2000) + (address - 0xA000);
        if (ramOffset >= 0 && ramOffset < this.cartridgeRam.length) {
            this.cartridgeRam[ramOffset] = value;
        }
    }

    private writeCartridgeControl(address: number, value: number) {
        if (!this.cartridgeRom) {
            this.memory[address] = value;
            return;
        }

        if (this.mbcType === "rom-only") {
            return;
        }

        if (this.mbcType === "mbc1") {
            if (address <= 0x1FFF) {
                this.ramEnabled = (value & 0x0F) === 0x0A;
                return;
            }

            if (address <= 0x3FFF) {
                this.currentRomBank = value & 0x1F;
                if ((this.currentRomBank & 0x1F) === 0) {
                    this.currentRomBank = (this.currentRomBank & 0x60) | 0x01;
                }
                this.normalizeRomBank();
                return;
            }

            if (address <= 0x5FFF) {
                this.currentRamBank = value & 0x03;
                this.normalizeRomBank();
                return;
            }

            this.mbc1BankingMode = value & 0x01;
            return;
        }

        if (this.mbcType === "mbc3") {
            if (address <= 0x1FFF) {
                this.ramEnabled = (value & 0x0F) === 0x0A;
                return;
            }

            if (address <= 0x3FFF) {
                this.currentRomBank = value & 0x7F;
                if (this.currentRomBank === 0) {
                    this.currentRomBank = 1;
                }
                this.normalizeRomBank();
                return;
            }

            if (address <= 0x5FFF) {
                if (value <= 0x03) {
                    this.currentRamBank = value & 0x03;
                    this.mbc3RtcSelectedRegister = null;
                } else if (value >= 0x08 && value <= 0x0C) {
                    this.mbc3RtcSelectedRegister = value;
                }
                return;
            }

            this.updateMbc3Rtc();
            if (value === 0x00) {
                this.mbc3RtcLatchPrimed = true;
            } else if (value === 0x01 && this.mbc3RtcLatchPrimed) {
                this.mbc3RtcLatchedRegisters.set(this.mbc3RtcRegisters);
                this.mbc3RtcLatchPrimed = false;
            } else {
                this.mbc3RtcLatchPrimed = false;
            }
            return;
        }

        if (address <= 0x1FFF) {
            this.ramEnabled = (value & 0x0F) === 0x0A;
            return;
        }

        if (address <= 0x2FFF) {
            this.currentRomBank = (this.currentRomBank & 0x100) | (value & 0xFF);
            this.normalizeRomBank();
            return;
        }

        if (address <= 0x3FFF) {
            this.currentRomBank = ((value & 0x01) << 8) | (this.currentRomBank & 0xFF);
            this.normalizeRomBank();
            return;
        }

        if (address <= 0x5FFF) {
            if (this.ramBankCount === 0) {
                this.currentRamBank = 0;
                return;
            }

            const bankMask = this.hasMbc5Rumble() ? 0x07 : 0x0F;
            this.currentRamBank = (value & bankMask) % this.ramBankCount;
        }
    }

    private normalizeRomBank() {
        if (!this.cartridgeRom || this.romBankCount <= 0) {
            this.currentRomBank = 1;
            return;
        }

        this.currentRomBank %= this.romBankCount;
        if (this.mbcType === "mbc1" && (this.currentRomBank & 0x1F) === 0) {
            this.currentRomBank = (this.currentRomBank + 1) % this.romBankCount;
            if (this.currentRomBank === 0 && this.romBankCount > 1) {
                this.currentRomBank = 1;
            }
        }
    }

    private resolveActiveRamBank(): number {
        if (this.ramBankCount <= 0) {
            return 0;
        }

        if (this.mbcType === "mbc1") {
            if (this.mbc1BankingMode === 0) {
                return 0;
            }

            return (this.currentRamBank & 0x03) % this.ramBankCount;
        }

        return this.currentRamBank % this.ramBankCount;
    }

    private isCartridgeRamAccessible(): boolean {
        if (this.mbcType === "rom-only") {
            return this.cartridgeRam.length > 0;
        }

        return this.ramEnabled;
    }

    private isAudioMasterEnabled(): boolean {
        return (this.memory[0xFF26] & 0x80) !== 0;
    }

    private handleAudioRegisterWrite(address: number, value: number) {
        if (address === 0xFF26) {
            if ((value & 0x80) === 0) {
                for (let clearAddress = 0xFF10; clearAddress <= 0xFF25; clearAddress += 1) {
                    this.memory[clearAddress] = 0x00;
                }
                this.audioChannelActive = [false, false, false, false];
            }

            this.memory[0xFF26] = value & 0x80;
            this.refreshAudioStatusRegister();
            return;
        }

        if (address === 0xFF12 && (value & 0xF8) === 0) {
            this.audioChannelActive[0] = false;
        }

        if (address === 0xFF17 && (value & 0xF8) === 0) {
            this.audioChannelActive[1] = false;
        }

        if (address === 0xFF1A && (value & 0x80) === 0) {
            this.audioChannelActive[2] = false;
        }

        if (address === 0xFF21 && (value & 0xF8) === 0) {
            this.audioChannelActive[3] = false;
        }

        if (address === 0xFF14 && (value & 0x80) !== 0) {
            this.triggerAudioChannel(0);
        }

        if (address === 0xFF19 && (value & 0x80) !== 0) {
            this.triggerAudioChannel(1);
        }

        if (address === 0xFF1E && (value & 0x80) !== 0) {
            this.triggerAudioChannel(2);
        }

        if (address === 0xFF23 && (value & 0x80) !== 0) {
            this.triggerAudioChannel(3);
        }

        this.refreshAudioStatusRegister();
    }

    private triggerAudioChannel(channelIndex: number) {
        if (!this.isAudioMasterEnabled()) {
            return;
        }

        this.audioChannelActive[channelIndex] = this.isAudioDacEnabled(channelIndex);
    }

    private isAudioDacEnabled(channelIndex: number): boolean {
        switch (channelIndex) {
            case 0:
                return (this.memory[0xFF12] & 0xF8) !== 0;
            case 1:
                return (this.memory[0xFF17] & 0xF8) !== 0;
            case 2:
                return (this.memory[0xFF1A] & 0x80) !== 0;
            case 3:
                return (this.memory[0xFF21] & 0xF8) !== 0;
            default:
                return false;
        }
    }

    private refreshAudioStatusRegister() {
        let status = (this.memory[0xFF26] & 0x80) | 0x70;

        for (let index = 0; index < this.audioChannelActive.length; index += 1) {
            if (this.audioChannelActive[index]) {
                status |= 1 << index;
            }
        }

        this.memory[0xFF26] = status & 0xFF;
    }

    private getSquareAudioChannelState(
        channelIndex: 0 | 1,
        id: 1 | 2,
        nrx1: number,
        nrx2: number,
        nrx3: number,
        nrx4: number,
        nr51: number,
    ): AudioChannelState {
        const rawFrequency = this.memory[nrx3] | ((this.memory[nrx4] & 0x07) << 8);
        const frequency = rawFrequency >= 2048 ? 0 : 131072 / (2048 - rawFrequency);
        const volume = ((this.memory[nrx2] >> 4) & 0x0F) / 15;
        const channelBit = 1 << channelIndex;

        return {
            id,
            kind: "square",
            enabled: this.audioChannelActive[channelIndex] && this.isAudioDacEnabled(channelIndex),
            frequency,
            volume,
            duty: (this.memory[nrx1] >> 6) & 0x03,
            panRight: (nr51 & channelBit) !== 0,
            panLeft: (nr51 & (channelBit << 4)) !== 0,
            waveSamples: [],
        };
    }

    private getWaveAudioChannelState(nr51: number): AudioChannelState {
        const rawFrequency = this.memory[0xFF1D] | ((this.memory[0xFF1E] & 0x07) << 8);
        const frequency = rawFrequency >= 2048 ? 0 : 65536 / (2048 - rawFrequency);
        const volumeCode = (this.memory[0xFF1C] >> 5) & 0x03;
        const waveSamples: number[] = [];

        for (let address = 0xFF30; address <= 0xFF3F; address += 1) {
            const value = this.memory[address];
            waveSamples.push((value >> 4) / 15);
            waveSamples.push((value & 0x0F) / 15);
        }

        return {
            id: 3,
            kind: "wave",
            enabled: this.audioChannelActive[2] && this.isAudioDacEnabled(2),
            frequency,
            volume: this.resolveWaveChannelVolume(volumeCode),
            duty: 2,
            panRight: (nr51 & 0x04) !== 0,
            panLeft: (nr51 & 0x40) !== 0,
            waveSamples,
        };
    }

    private getNoiseAudioChannelState(nr51: number): AudioChannelState {
        const nr43 = this.memory[0xFF22];
        const divisorCode = nr43 & 0x07;
        const shiftClock = (nr43 >> 4) & 0x0F;
        const divisors = [8, 16, 32, 48, 64, 80, 96, 112];
        const divisor = divisors[divisorCode] ?? 8;
        const frequency = 524288 / divisor / Math.pow(2, shiftClock + 1);

        return {
            id: 4,
            kind: "noise",
            enabled: this.audioChannelActive[3] && this.isAudioDacEnabled(3),
            frequency,
            volume: ((this.memory[0xFF21] >> 4) & 0x0F) / 15,
            duty: 2,
            panRight: (nr51 & 0x08) !== 0,
            panLeft: (nr51 & 0x80) !== 0,
            waveSamples: [],
        };
    }

    private resolveWaveChannelVolume(volumeCode: number): number {
        switch (volumeCode) {
            case 0:
                return 0;
            case 1:
                return 1;
            case 2:
                return 0.5;
            case 3:
                return 0.25;
            default:
                return 0;
        }
    }

    private resolveDmgCompatibilityPalette(title: string, preferredName?: string): CompatibilityPaletteSet {
        if (preferredName === "GBC Pokemon Yellow") {
            return {
                name: "GBC Pokemon Yellow",
                bg: [
                    [255, 251, 197, 255],
                    [255, 216, 107, 255],
                    [189, 134, 52, 255],
                    [66, 40, 18, 255],
                ],
                obj0: [
                    [255, 251, 197, 255],
                    [255, 208, 82, 255],
                    [147, 101, 34, 255],
                    [45, 28, 12, 255],
                ],
                obj1: [
                    [255, 251, 197, 255],
                    [120, 191, 115, 255],
                    [63, 107, 85, 255],
                    [25, 41, 56, 255],
                ],
            };
        }

        if (preferredName === "GBC Pokemon Red") {
            return {
                name: "GBC Pokemon Red",
                bg: [
                    [255, 240, 214, 255],
                    [255, 167, 132, 255],
                    [173, 82, 82, 255],
                    [58, 24, 32, 255],
                ],
                obj0: [
                    [255, 240, 214, 255],
                    [255, 140, 110, 255],
                    [156, 67, 67, 255],
                    [47, 18, 22, 255],
                ],
                obj1: [
                    [255, 240, 214, 255],
                    [122, 195, 121, 255],
                    [54, 113, 91, 255],
                    [18, 37, 44, 255],
                ],
            };
        }

        if (preferredName === "GBC Pokemon Blue") {
            return {
                name: "GBC Pokemon Blue",
                bg: [
                    [240, 244, 255, 255],
                    [146, 182, 255, 255],
                    [72, 98, 189, 255],
                    [19, 33, 76, 255],
                ],
                obj0: [
                    [240, 244, 255, 255],
                    [123, 164, 255, 255],
                    [55, 85, 177, 255],
                    [18, 28, 63, 255],
                ],
                obj1: [
                    [240, 244, 255, 255],
                    [158, 203, 130, 255],
                    [63, 120, 95, 255],
                    [22, 39, 48, 255],
                ],
            };
        }

        if (preferredName === "GBC Default") {
            return {
                name: "GBC Default",
                bg: [
                    [255, 255, 255, 255],
                    [173, 173, 173, 255],
                    [90, 90, 90, 255],
                    [16, 16, 16, 255],
                ],
                obj0: [
                    [255, 255, 255, 255],
                    [255, 173, 99, 255],
                    [123, 90, 66, 255],
                    [16, 16, 16, 255],
                ],
                obj1: [
                    [255, 255, 255, 255],
                    [140, 189, 255, 255],
                    [74, 99, 181, 255],
                    [16, 16, 16, 255],
                ],
            };
        }

        const normalizedTitle = title.toUpperCase();

        if (normalizedTitle.includes("YEL") || normalizedTitle.includes("PIKACHU")) {
            return {
                name: "GBC Pokemon Yellow",
                bg: [
                    [255, 251, 197, 255],
                    [255, 216, 107, 255],
                    [189, 134, 52, 255],
                    [66, 40, 18, 255],
                ],
                obj0: [
                    [255, 251, 197, 255],
                    [255, 208, 82, 255],
                    [147, 101, 34, 255],
                    [45, 28, 12, 255],
                ],
                obj1: [
                    [255, 251, 197, 255],
                    [120, 191, 115, 255],
                    [63, 107, 85, 255],
                    [25, 41, 56, 255],
                ],
            };
        }

        if (normalizedTitle.includes("RED")) {
            return {
                name: "GBC Pokemon Red",
                bg: [
                    [255, 240, 214, 255],
                    [255, 167, 132, 255],
                    [173, 82, 82, 255],
                    [58, 24, 32, 255],
                ],
                obj0: [
                    [255, 240, 214, 255],
                    [255, 140, 110, 255],
                    [156, 67, 67, 255],
                    [47, 18, 22, 255],
                ],
                obj1: [
                    [255, 240, 214, 255],
                    [122, 195, 121, 255],
                    [54, 113, 91, 255],
                    [18, 37, 44, 255],
                ],
            };
        }

        if (normalizedTitle.includes("BLUE")) {
            return {
                name: "GBC Pokemon Blue",
                bg: [
                    [240, 244, 255, 255],
                    [146, 182, 255, 255],
                    [72, 98, 189, 255],
                    [19, 33, 76, 255],
                ],
                obj0: [
                    [240, 244, 255, 255],
                    [123, 164, 255, 255],
                    [55, 85, 177, 255],
                    [18, 28, 63, 255],
                ],
                obj1: [
                    [240, 244, 255, 255],
                    [158, 203, 130, 255],
                    [63, 120, 95, 255],
                    [22, 39, 48, 255],
                ],
            };
        }

        return {
            name: "GBC Default",
            bg: [
                [255, 255, 255, 255],
                [173, 173, 173, 255],
                [90, 90, 90, 255],
                [16, 16, 16, 255],
            ],
            obj0: [
                [255, 255, 255, 255],
                [255, 173, 99, 255],
                [123, 90, 66, 255],
                [16, 16, 16, 255],
            ],
            obj1: [
                [255, 255, 255, 255],
                [140, 189, 255, 255],
                [74, 99, 181, 255],
                [16, 16, 16, 255],
            ],
        };
    }

    private resolveMbc1RomBank(address: number): number {
        const upperBits = (this.currentRamBank & 0x03) << 5;

        if (address < 0x4000) {
            if (this.mbc1BankingMode === 0) {
                return 0;
            }

            return upperBits % this.romBankCount;
        }

        let bank = upperBits | (this.currentRomBank & 0x1F);
        if ((bank & 0x1F) === 0) {
            bank += 1;
        }

        return bank % this.romBankCount;
    }

    private supportsMbc3Rtc(): boolean {
        return this.cartridgeType === 0x0F || this.cartridgeType === 0x10;
    }

    private hasMbc5Rumble(): boolean {
        return this.cartridgeType === 0x1C || this.cartridgeType === 0x1D || this.cartridgeType === 0x1E;
    }

    private hasBatteryBackedRam(): boolean {
        switch (this.cartridgeType) {
            case 0x03:
            case 0x06:
            case 0x09:
            case 0x0D:
            case 0x0F:
            case 0x10:
            case 0x13:
            case 0x1B:
            case 0x1E:
            case 0x22:
            case 0xFF:
                return true;
            default:
                return false;
        }
    }

    private getCartridgeTitle(): string {
        if (!this.cartridgeRom) {
            return "Unknown";
        }

        const titleBytes = this.cartridgeRom.slice(0x0134, 0x0144);
        let title = "";

        for (const value of titleBytes) {
            if (value === 0x00) {
                break;
            }

            title += String.fromCharCode(value);
        }

        return title || "Unknown";
    }

    private resolveCartridgeTypeName(cartridgeType: number): string {
        switch (cartridgeType) {
            case 0x00:
                return "ROM ONLY";
            case 0x08:
                return "ROM+RAM";
            case 0x09:
                return "ROM+RAM+BATTERY";
            case 0x01:
                return "MBC1";
            case 0x02:
                return "MBC1+RAM";
            case 0x03:
                return "MBC1+RAM+BATTERY";
            case 0x0F:
                return "MBC3+TIMER+BATTERY";
            case 0x10:
                return "MBC3+TIMER+RAM+BATTERY";
            case 0x11:
                return "MBC3";
            case 0x12:
                return "MBC3+RAM";
            case 0x13:
                return "MBC3+RAM+BATTERY";
            case 0x19:
                return "MBC5";
            case 0x1A:
                return "MBC5+RAM";
            case 0x1B:
                return "MBC5+RAM+BATTERY";
            case 0x1C:
                return "MBC5+RUMBLE";
            case 0x1D:
                return "MBC5+RUMBLE+RAM";
            case 0x1E:
                return "MBC5+RUMBLE+RAM+BATTERY";
            default:
                return `UNKNOWN (0x${cartridgeType.toString(16).toUpperCase().padStart(2, "0")})`;
        }
    }

    private updateMbc3Rtc() {
        if (!this.supportsMbc3Rtc()) {
            return;
        }

        const now = Date.now();
        const dayHigh = this.mbc3RtcRegisters[4] ?? 0;
        const halted = (dayHigh & 0x40) !== 0;

        if (halted) {
            this.mbc3RtcLastUpdateMs = now;
            return;
        }

        const elapsedSeconds = Math.floor((now - this.mbc3RtcLastUpdateMs) / 1000);
        if (elapsedSeconds <= 0) {
            return;
        }

        this.mbc3RtcLastUpdateMs += elapsedSeconds * 1000;
        this.incrementMbc3Rtc(elapsedSeconds);
    }

    private incrementMbc3Rtc(secondsToAdd: number) {
        let totalSeconds =
            (this.mbc3RtcRegisters[0] ?? 0) +
            ((this.mbc3RtcRegisters[1] ?? 0) * 60) +
            ((this.mbc3RtcRegisters[2] ?? 0) * 3600) +
            (this.getMbc3RtcDayCounter() * 86_400);

        totalSeconds += secondsToAdd;

        const totalDays = Math.floor(totalSeconds / 86_400);
        const wrappedDays = totalDays % 512;
        const overflowed = totalDays >= 512;
        const secondsWithinDay = totalSeconds % 86_400;
        const hours = Math.floor(secondsWithinDay / 3600);
        const minutes = Math.floor((secondsWithinDay % 3600) / 60);
        const seconds = secondsWithinDay % 60;
        const existingDayHigh = this.mbc3RtcRegisters[4] ?? 0;
        const haltBit = existingDayHigh & 0x40;
        const carryBit = overflowed ? 0x80 : (existingDayHigh & 0x80);

        this.mbc3RtcRegisters[0] = seconds & 0x3F;
        this.mbc3RtcRegisters[1] = minutes & 0x3F;
        this.mbc3RtcRegisters[2] = hours & 0x1F;
        this.mbc3RtcRegisters[3] = wrappedDays & 0xFF;
        this.mbc3RtcRegisters[4] = haltBit | carryBit | ((wrappedDays >> 8) & 0x01);
    }

    private getMbc3RtcDayCounter(): number {
        return (this.mbc3RtcRegisters[3] ?? 0) | (((this.mbc3RtcRegisters[4] ?? 0) & 0x01) << 8);
    }

    private writeMbc3RtcRegister(register: number, value: number) {
        const registerIndex = register - 0x08;
        if (registerIndex < 0 || registerIndex >= this.mbc3RtcRegisters.length) {
            return;
        }

        if (register === 0x08) {
            this.mbc3RtcRegisters[0] = value & 0x3F;
        } else if (register === 0x09) {
            this.mbc3RtcRegisters[1] = value & 0x3F;
        } else if (register === 0x0A) {
            this.mbc3RtcRegisters[2] = value & 0x1F;
        } else if (register === 0x0B) {
            this.mbc3RtcRegisters[3] = value & 0xFF;
        } else if (register === 0x0C) {
            this.mbc3RtcRegisters[4] = value & 0xC1;
        }

        this.mbc3RtcLastUpdateMs = Date.now();
    }

    private resolveMbcType(cartridgeType: number): CartridgeMapper {
        switch (cartridgeType) {
            case 0x01:
            case 0x02:
            case 0x03:
                return "mbc1";
            case 0x0F:
            case 0x10:
            case 0x11:
            case 0x12:
            case 0x13:
                return "mbc3";
            case 0x19:
            case 0x1A:
            case 0x1B:
            case 0x1C:
            case 0x1D:
            case 0x1E:
                return "mbc5";
            default:
                return "rom-only";
        }
    }

    private resolveCartridgeRomBankCount(romSizeCode: number, romLength: number): number {
        switch (romSizeCode) {
            case 0x00:
                return 2;
            case 0x01:
                return 4;
            case 0x02:
                return 8;
            case 0x03:
                return 16;
            case 0x04:
                return 32;
            case 0x05:
                return 64;
            case 0x06:
                return 128;
            case 0x07:
                return 256;
            case 0x08:
                return 512;
            case 0x52:
                return 72;
            case 0x53:
                return 80;
            case 0x54:
                return 96;
            default:
                return Math.max(1, Math.ceil(romLength / 0x4000));
        }
    }

    private resolveCartridgeRamBankCount(ramSize: number): number {
        if (ramSize <= 0) {
            return 0;
        }

        return Math.max(1, Math.ceil(ramSize / 0x2000));
    }

    private resolveCartridgeRamSize(ramSizeCode: number): number {
        switch (ramSizeCode) {
            case 0x00:
                return 0;
            case 0x01:
                return 0x0800;
            case 0x02:
                return 0x2000;
            case 0x03:
                return 0x8000;
            case 0x04:
                return 0x20000;
            case 0x05:
                return 0x10000;
            default:
                return 0;
        }
    }
}
