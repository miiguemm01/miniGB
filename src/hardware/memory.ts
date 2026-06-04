export type JoypadButton =
    | "right"
    | "left"
    | "up"
    | "down"
    | "a"
    | "b"
    | "select"
    | "start";

export type MemoryStateSnapshot = {
    memory: number[];
    cartridgeRam: number[];
    currentRomBank: number;
    currentRamBank: number;
    ramEnabled: boolean;
    mbcType: "rom-only" | "mbc5";
    ly: number;
    divCycleCounter: number;
    lcdCycleCounter: number;
    joypSelect: number;
    joypadState: Record<JoypadButton, boolean>;
};

export class Memory {
    private memory: Uint8Array;
    private cartridgeRom: Uint8Array | null = null;
    private cartridgeRam = new Uint8Array(0);
    private currentRomBank = 1;
    private currentRamBank = 0;
    private ramEnabled = false;
    private mbcType: "rom-only" | "mbc5" = "rom-only";

    private ly = 0; // LCD Y-coordinate register (0xFF44)
    private divCycleCounter = 0;
    private lcdCycleCounter = 0;
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

        if (address >= 0xA000 && address <= 0xBFFF) {
            return this.readCartridgeRam(address);
        }

        if (address < 0 || address >= this.memory.length) {
            throw new Error(`Memory read out of bounds at address 0x${address.toString(16)}`);
        }

        if (address === 0xFF00) {
            return this.getJoypadValue();
        }

        if (address === 0xFF44) {
            return this.ly;
        }

        return this.memory[address];
    }

    peekByte(address: number): number {
        if (address >= 0x0000 && address <= 0x7FFF) {
            return this.readCartridgeRom(address);
        }

        if (address >= 0xA000 && address <= 0xBFFF) {
            return this.readCartridgeRam(address);
        }

        if (address < 0 || address >= this.memory.length) {
            throw new Error(`Memory peek out of bounds at address 0x${address.toString(16)}`);
        }

        if (address === 0xFF00) {
            return this.getJoypadValue();
        }

        if (address === 0xFF44) {
            return this.ly;
        }

        return this.memory[address];
    }

    writeByte(address: number, value: number) {
        if (address >= 0x0000 && address <= 0x7FFF) {
            this.writeCartridgeControl(address, value & 0xFF);
            return;
        }

        if (address >= 0xA000 && address <= 0xBFFF) {
            this.writeCartridgeRam(address, value & 0xFF);
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

        if (address === 0xFF44) {
            this.ly = 0;
            this.memory[address] = 0;
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
        this.currentRomBank = 1;
        this.currentRamBank = 0;
        this.ramEnabled = false;
        this.mbcType = this.resolveMbcType(romData[0x0147] ?? 0x00);
        this.cartridgeRam = new Uint8Array(this.resolveCartridgeRamSize(romData[0x0149] ?? 0x00));
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

    initializeDmgPostBootState() {
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
            [0xFF50, 0x01], // Boot ROM disabled
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
    }

    saveState(): MemoryStateSnapshot {
        return {
            memory: Array.from(this.memory),
            cartridgeRam: Array.from(this.cartridgeRam),
            currentRomBank: this.currentRomBank,
            currentRamBank: this.currentRamBank,
            ramEnabled: this.ramEnabled,
            mbcType: this.mbcType,
            ly: this.ly,
            divCycleCounter: this.divCycleCounter,
            lcdCycleCounter: this.lcdCycleCounter,
            joypSelect: this.joypSelect,
            joypadState: { ...this.joypadState },
        };
    }

    loadState(snapshot: MemoryStateSnapshot) {
        this.memory = Uint8Array.from(snapshot.memory);
        this.cartridgeRam = Uint8Array.from(snapshot.cartridgeRam);
        this.currentRomBank = snapshot.currentRomBank;
        this.currentRamBank = snapshot.currentRamBank;
        this.ramEnabled = snapshot.ramEnabled;
        this.mbcType = snapshot.mbcType;
        this.ly = snapshot.ly;
        this.divCycleCounter = snapshot.divCycleCounter;
        this.lcdCycleCounter = snapshot.lcdCycleCounter;
        this.joypSelect = snapshot.joypSelect;
        this.joypadState = { ...snapshot.joypadState };
    }

    tick(cycles: number) {
        if (cycles <= 0) {
            return;
        }

        this.divCycleCounter += cycles;
        while (this.divCycleCounter >= 256) {
            this.divCycleCounter -= 256;
            this.memory[0xFF04] = (this.memory[0xFF04] + 1) & 0xFF;
        }

        const lcdEnabled = (this.memory[0xFF40] & 0x80) !== 0;
        if (!lcdEnabled) {
            this.ly = 0;
            this.lcdCycleCounter = 0;
            this.memory[0xFF44] = 0;
            return;
        }

        this.lcdCycleCounter += cycles;
        while (this.lcdCycleCounter >= 456) {
            this.lcdCycleCounter -= 456;
            this.ly = (this.ly + 1) % 154;
            this.memory[0xFF44] = this.ly;

            if (this.ly === 144) {
                this.requestInterrupt(0x01);
            }
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

        if (address < 0x4000) {
            return this.cartridgeRom[address] ?? 0xFF;
        }

        const bankOffset = this.currentRomBank * 0x4000;
        const romOffset = bankOffset + (address - 0x4000);

        return this.cartridgeRom[romOffset] ?? 0xFF;
    }

    private readCartridgeRam(address: number): number {
        if (!this.ramEnabled || this.cartridgeRam.length === 0) {
            return 0xFF;
        }

        const ramOffset = (this.currentRamBank * 0x2000) + (address - 0xA000);
        return this.cartridgeRam[ramOffset] ?? 0xFF;
    }

    private writeCartridgeRam(address: number, value: number) {
        if (!this.ramEnabled || this.cartridgeRam.length === 0) {
            return;
        }

        const ramOffset = (this.currentRamBank * 0x2000) + (address - 0xA000);
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

        if (address <= 0x1FFF) {
            this.ramEnabled = (value & 0x0F) === 0x0A;
            return;
        }

        if (address <= 0x2FFF) {
            this.currentRomBank = (this.currentRomBank & 0x100) | value;
            this.normalizeRomBank();
            return;
        }

        if (address <= 0x3FFF) {
            this.currentRomBank = ((value & 0x01) << 8) | (this.currentRomBank & 0xFF);
            this.normalizeRomBank();
            return;
        }

        if (address <= 0x5FFF) {
            const ramBankCount = Math.max(1, Math.ceil(this.cartridgeRam.length / 0x2000));
            this.currentRamBank = value % ramBankCount;
        }
    }

    private normalizeRomBank() {
        if (!this.cartridgeRom) {
            this.currentRomBank = 1;
            return;
        }

        const bankCount = Math.max(1, Math.floor(this.cartridgeRom.length / 0x4000));
        this.currentRomBank %= bankCount;
    }

    private resolveMbcType(cartridgeType: number): "rom-only" | "mbc5" {
        switch (cartridgeType) {
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
