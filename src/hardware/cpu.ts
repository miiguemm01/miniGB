import { Memory } from "./memory";

type CpuFlags = {
    z: boolean;
    n: boolean;
    h: boolean;
    c: boolean;
};

export type CpuStateSnapshot = {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    h: number;
    l: number;
    pc: number;
    sp: number;
    halted: boolean;
    f: number;
    ime: boolean;
    imeScheduled: boolean;
    flags: CpuFlags;
};

export class CPU {
    public a = 0;
    public b = 0;
    public c = 0;
    public d = 0;
    public e = 0;
    public h = 0;
    public l = 0;
    public pc = 0x0100;
    public sp = 0xFFFE;
    public memory: Memory;
    public halted = false;

    public f = 0;

    public ime = false; // Interrupt Master Enable Flag
    public imeScheduled = false; // Flag to enable IME after the next instruction

    public flags: CpuFlags = {
        z: false, // Zero Flag
        n: false, // Subtract Flag
        h: false, // Half Carry Flag
        c: false, // Carry Flag
    };

    constructor(memoryInstance: Memory) {
        this.memory = memoryInstance;
    }

    initializeDmgPostBootState() {
        this.a = 0x01;
        this.b = 0x00;
        this.c = 0x13;
        this.d = 0x00;
        this.e = 0xD8;
        this.h = 0x01;
        this.l = 0x4D;
        this.pc = 0x0100;
        this.sp = 0xFFFE;
        this.ime = false;
        this.imeScheduled = false;
        this.flags = {
            z: true,
            n: false,
            h: true,
            c: true,
        };
        this.updateFRegister();
    }

    initializeCgbPostBootState() {
        this.a = 0x11;
        this.b = 0x00;
        this.c = 0x00;
        this.d = 0xFF;
        this.e = 0x56;
        this.h = 0x00;
        this.l = 0x0D;
        this.pc = 0x0100;
        this.sp = 0xFFFE;
        this.halted = false;
        this.ime = false;
        this.imeScheduled = false;
        this.flags = {
            z: true,
            n: false,
            h: false,
            c: false,
        };
        this.updateFRegister();
    }

    saveState(): CpuStateSnapshot {
        return {
            a: this.a,
            b: this.b,
            c: this.c,
            d: this.d,
            e: this.e,
            h: this.h,
            l: this.l,
            pc: this.pc,
            sp: this.sp,
            halted: this.halted,
            f: this.f,
            ime: this.ime,
            imeScheduled: this.imeScheduled,
            flags: { ...this.flags },
        };
    }

    loadState(snapshot: CpuStateSnapshot) {
        this.a = snapshot.a;
        this.b = snapshot.b;
        this.c = snapshot.c;
        this.d = snapshot.d;
        this.e = snapshot.e;
        this.h = snapshot.h;
        this.l = snapshot.l;
        this.pc = snapshot.pc;
        this.sp = snapshot.sp;
        this.halted = snapshot.halted;
        this.f = snapshot.f;
        this.ime = snapshot.ime;
        this.imeScheduled = snapshot.imeScheduled;
        this.flags = { ...snapshot.flags };
        this.updateFRegister();
    }

    private setFlags(flags: Partial<CpuFlags>) {
        this.flags = {
            ...this.flags,
            ...flags,
        };
        this.updateFRegister();
    }

    private updateFRegister() {
        this.f =
            (this.flags.z ? 0x80 : 0) |
            (this.flags.n ? 0x40 : 0) |
            (this.flags.h ? 0x20 : 0) |
            (this.flags.c ? 0x10 : 0);
    }

    toSigned8(value: number): number {
        return value > 0x7F ? value - 0x100 : value;
    }

    private advancePc(step: number) {
        this.pc = (this.pc + step) & 0xFFFF;
    }

    private getHlAddress(): number {
        return (this.h << 8) | this.l;
    }

    private getRegByCode(code: number): number {
        switch (code & 0x07) {
            case 0:
                return this.b;
            case 1:
                return this.c;
            case 2:
                return this.d;
            case 3:
                return this.e;
            case 4:
                return this.h;
            case 5:
                return this.l;
            case 6:
                return this.memory.readByte(this.getHlAddress());
            case 7:
                return this.a;
            default:
                throw new Error(`Invalid register code: ${code}`);
        }
    }

    private setRegByCode(code: number, value: number) {
        const normalizedValue = value & 0xFF;

        switch (code & 0x07) {
            case 0:
                this.b = normalizedValue;
                return;
            case 1:
                this.c = normalizedValue;
                return;
            case 2:
                this.d = normalizedValue;
                return;
            case 3:
                this.e = normalizedValue;
                return;
            case 4:
                this.h = normalizedValue;
                return;
            case 5:
                this.l = normalizedValue;
                return;
            case 6:
                this.memory.writeByte(this.getHlAddress(), normalizedValue);
                return;
            case 7:
                this.a = normalizedValue;
                return;
            default:
                throw new Error(`Invalid register code: ${code}`);
        }
    }

    private getPendingInterrupts(): number {
        const interruptEnable = this.memory.peekByte(0xFFFF);
        const interruptFlags = this.memory.peekByte(0xFF0F);
        return interruptEnable & interruptFlags & 0x1F;
    }

    serviceInterrupts(): number {
        const pendingInterrupts = this.getPendingInterrupts();
        if (pendingInterrupts === 0) {
            return 0;
        }

        this.halted = false;
        if (!this.ime) {
            return 0;
        }

        const interruptTable: Array<[number, number]> = [
            [0x01, 0x0040], // VBlank
            [0x02, 0x0048], // LCD STAT
            [0x04, 0x0050], // Timer
            [0x08, 0x0058], // Serial
            [0x10, 0x0060], // Joypad
        ];

        for (const [mask, vector] of interruptTable) {
            if ((pendingInterrupts & mask) === 0) {
                continue;
            }

            const interruptFlags = this.memory.peekByte(0xFF0F);
            this.memory.writeByte(0xFF0F, (interruptFlags & ~mask) | 0xE0);
            this.ime = false;
            this.imeScheduled = false;
            this.sp = (this.sp - 2) & 0xFFFF;
            this.memory.writeWord(this.sp, this.pc);
            this.pc = vector;
            return 20;
        }

        return 0;
    }

    private formatCpuContext(opcode: number) {
        const next1 = this.memory.peekByte((this.pc + 1) & 0xFFFF);
        const next2 = this.memory.peekByte((this.pc + 2) & 0xFFFF);

        return [
            `opcode=0x${opcode.toString(16).toUpperCase().padStart(2, "0")}`,
            `pc=0x${this.pc.toString(16).toUpperCase().padStart(4, "0")}`,
            `sp=0x${this.sp.toString(16).toUpperCase().padStart(4, "0")}`,
            `next=[0x${next1.toString(16).toUpperCase().padStart(2, "0")},0x${next2.toString(16).toUpperCase().padStart(2, "0")}]`,
            `af=0x${(((this.a << 8) | this.f) & 0xFFFF).toString(16).toUpperCase().padStart(4, "0")}`,
            `bc=0x${(((this.b << 8) | this.c) & 0xFFFF).toString(16).toUpperCase().padStart(4, "0")}`,
            `de=0x${(((this.d << 8) | this.e) & 0xFFFF).toString(16).toUpperCase().padStart(4, "0")}`,
            `hl=0x${(((this.h << 8) | this.l) & 0xFFFF).toString(16).toUpperCase().padStart(4, "0")}`,
        ].join(" ");
    }

    private addToA(value: number) {
        const originalA = this.a;
        const result = originalA + value;

        this.a = result & 0xFF;
        this.setFlags({
            z: this.a === 0,
            n: false,
            h: ((originalA & 0x0F) + (value & 0x0F)) > 0x0F,
            c: result > 0xFF,
        });
    }

    private subtractFromA(value: number) {
        const originalA = this.a;
        const result = originalA - value;

        this.a = result & 0xFF;
        this.setFlags({
            z: this.a === 0,
            n: true,
            h: (originalA & 0x0F) < (value & 0x0F),
            c: originalA < value,
        });
    }

    private compareWithA(value: number) {
        const originalA = this.a;
        const result = (originalA - value) & 0xFF;

        this.setFlags({
            z: result === 0,
            n: true,
            h: (originalA & 0x0F) < (value & 0x0F),
            c: originalA < value,
        });
    }

    private increment8(value: number): number {
        const result = (value + 1) & 0xFF;

        this.setFlags({
            z: result === 0,
            n: false,
            h: ((value & 0x0F) + 1) > 0x0F,
        });

        return result;
    }

    private decrement8(value: number): number {
        const result = (value - 1) & 0xFF;

        this.setFlags({
            z: result === 0,
            n: true,
            h: (value & 0x0F) === 0,
        });

        return result;
    }

    execute(opcode: number, nextByte?: number, lowByte?: number, highByte?: number) {
        const wasIMEScheduled = this.imeScheduled;

        if (opcode >= 0x40 && opcode <= 0x7F && opcode !== 0x76) {
            const destinationCode = (opcode >> 3) & 0x07;
            const sourceCode = opcode & 0x07;
            const value = this.getRegByCode(sourceCode);

            this.setRegByCode(destinationCode, value);
            this.advancePc(1);

            if (wasIMEScheduled) {
                this.ime = true;
                this.imeScheduled = false;
            }

            return;
        }

        switch (opcode) {
            case 0x00: // NOP
                this.advancePc(1);
                break;
            case 0x3E: // LD A, d8
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for LD A, d8 instruction");
                }
                this.a = nextByte;
                this.advancePc(2);
                break;
            case 0x06:
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for LD B, d8 instruction");
                }
                this.b = nextByte;
                this.advancePc(2);
                break;
            case 0x0E:
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for LD C, d8 instruction");
                }
                this.c = nextByte;
                this.advancePc(2);
                break;
            case 0x16:
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for LD D, d8 instruction");
                }
                this.d = nextByte;
                this.advancePc(2);
                break;
            case 0x1E:
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for LD E, d8 instruction");
                }
                this.e = nextByte;
                this.advancePc(2);
                break;
            case 0x26:
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for LD H, d8 instruction");
                }
                this.h = nextByte;
                this.advancePc(2);
                break;
            case 0x2E:
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for LD L, d8 instruction");
                }
                this.l = nextByte;
                this.advancePc(2);
                break;
            case 0x7F: // LD A, A
                this.advancePc(1);
                break;
            case 0x78: // LD A, B
                this.a = this.b;
                this.advancePc(1);
                break;
            case 0x79: // LD A, C
                this.a = this.c;
                this.advancePc(1);
                break;
            case 0x7A: // LD A, D
                this.a = this.d;
                this.advancePc(1);
                break;
            case 0x7B: // LD A, E
                this.a = this.e;
                this.advancePc(1);
                break;
            case 0x7C: // LD A, H
                this.a = this.h;
                this.advancePc(1);
                break;
            case 0x7D: // LD A, L
                this.a = this.l;
                this.advancePc(1);
                break;
            case 0xAF: // XOR A
                this.a = 0;
                this.setFlags({
                    z: true,
                    n: false,
                    h: false,
                    c: false,
                });
                this.advancePc(1);
                break;
            case 0x80: // ADD A, B
                this.addToA(this.b);
                this.advancePc(1);
                break;
            case 0x81: // ADD A, C
                this.addToA(this.c);
                this.advancePc(1);
                break;
            case 0x82: // ADD A, D
                this.addToA(this.d);
                this.advancePc(1);
                break;
            case 0x83: // ADD A, E
                this.addToA(this.e);
                this.advancePc(1);
                break;
            case 0x84: // ADD A, H
                this.addToA(this.h);
                this.advancePc(1);
                break;
            case 0x85: // ADD A, L
                this.addToA(this.l);
                this.advancePc(1);
                break;
            case 0x87: // ADD A, A
                this.addToA(this.a);
                this.advancePc(1);
                break;
            case 0x90:
                this.subtractFromA(this.b);
                this.advancePc(1);
                break;
            case 0x91:
                this.subtractFromA(this.c);
                this.advancePc(1);
                break;
            case 0x92:
                this.subtractFromA(this.d);
                this.advancePc(1);
                break;
            case 0x93:
                this.subtractFromA(this.e);
                this.advancePc(1);
                break;
            case 0x94:
                this.subtractFromA(this.h);
                this.advancePc(1);
                break;
            case 0x95:
                this.subtractFromA(this.l);
                this.advancePc(1);
                break;
            case 0x97:
                this.subtractFromA(this.a);
                this.advancePc(1);
                break;
            case 0x3C: // INC A
                this.a = this.increment8(this.a);
                this.advancePc(1);
                break;
            case 0x04: // INC B
                this.b = this.increment8(this.b);
                this.advancePc(1);
                break;
            case 0x0C: // INC C
                this.c = this.increment8(this.c);
                this.advancePc(1);
                break;
            case 0x3D: // DEC A
                this.a = this.decrement8(this.a);
                this.advancePc(1);
                break;
            case 0x05: // DEC B
                this.b = this.decrement8(this.b);
                this.advancePc(1);
                break;
            case 0x0D: // DEC C
                this.c = this.decrement8(this.c);
                this.advancePc(1);
                break;
            case 0x18: { // JR r8
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for JR r8 instruction");
                }

                const offset = this.toSigned8(nextByte);
                this.pc = (this.pc + 2 + offset) & 0xFFFF;
                break;
            }
            case 0x30: { // JR NC, r8
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for JR NC, r8 instruction");
                }
                if (!this.flags.c) {
                    const offset = this.toSigned8(nextByte);
                    this.pc = (this.pc + 2 + offset) & 0xFFFF;
                } else {
                    this.advancePc(2);
                }
                break;
            }
            case 0xC3: // JP a16
                if (lowByte === undefined || highByte === undefined) {
                    throw new Error("Expected two bytes for JP a16 instruction");
                }
                this.pc = (highByte << 8) | lowByte;
                break;
            case 0xC2: // JP NZ, a16
                if (lowByte === undefined || highByte === undefined) {
                    throw new Error("Expected two bytes for JP NZ, a16 instruction");
                }
                if (!this.flags.z) {
                    this.pc = (highByte << 8) | lowByte;
                } else {
                    this.advancePc(3);
                }
                break;
            case 0xCA: // JP Z, a16
                if (lowByte === undefined || highByte === undefined) {
                    throw new Error("Expected two bytes for JP Z, a16 instruction");
                }
                if (this.flags.z) {
                    this.pc = (highByte << 8) | lowByte;
                } else {
                    this.advancePc(3);
                }
                break;
            case 0xD2: // JP NC, a16
                if (lowByte === undefined || highByte === undefined) {
                    throw new Error("Expected two bytes for JP NC, a16 instruction");
                }
                if (!this.flags.c) {
                    this.pc = (highByte << 8) | lowByte;
                } else {
                    this.advancePc(3);
                }
                break;
            case 0xDA: // JP C, a16
                if (lowByte === undefined || highByte === undefined) {
                    throw new Error("Expected two bytes for JP C, a16 instruction");
                }
                if (this.flags.c) {
                    this.pc = (highByte << 8) | lowByte;
                } else {
                    this.advancePc(3);
                }
                break;
            case 0xE9: // JP HL
                this.pc = (this.h << 8) | this.l;
                break;
            case 0xFF: // RST 38H
                this.sp = (this.sp - 2) & 0xFFFF;
                this.memory.writeWord(this.sp, (this.pc + 1) & 0xFFFF);
                this.pc = 0x0038;
                break;
            case 0xFE: // CP A, d8
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for CP A, d8 instruction");
                }
                this.compareWithA(nextByte);
                this.advancePc(2);
                break;
            case 0x28: { // JR Z, r8
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for JR Z, r8 instruction");
                }
                if (this.flags.z) {
                    const offset = this.toSigned8(nextByte);
                    this.pc = (this.pc + 2 + offset) & 0xFFFF;
                } else {
                    this.advancePc(2);
                }
                break;
            }
            case 0xEA: { // LD (a16), A
                if (lowByte === undefined || highByte === undefined) {
                    throw new Error("Expected two bytes for LD (a16), A instruction");
                }
                const address = (highByte << 8) | lowByte;
                this.memory.writeByte(address, this.a);
                this.advancePc(3);
                break;
            }
            case 0xF3: // DI
                this.ime = false;
                this.advancePc(1);
                break;
            case 0xFB: // EI
                this.imeScheduled = true;
                this.advancePc(1);
                break;
            case 0xE0: { // LDH (a8), A
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for LDH (a8), A instruction");
                }
                const address = 0xFF00 + nextByte;
                this.memory.writeByte(address, this.a);
                this.advancePc(2);
                break;
            }
            case 0xCD: { // CALL a16
                if (lowByte === undefined || highByte === undefined) {
                    throw new Error("Expected two bytes for CALL a16 instruction");
                }
                const address = (highByte << 8) | lowByte;
                this.sp = (this.sp - 2) & 0xFFFF;
                this.memory.writeWord(this.sp, (this.pc + 3) & 0xFFFF);
                this.pc = address;
                break;
            }
            case 0xF0: { // LDH A, (a8)
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for LDH A, (a8) instruction");
                }
                const address = 0xFF00 + nextByte;
                this.a = this.memory.readByte(address);
                this.advancePc(2);
                break;
            }
            case 0x47: // LD B, A
                this.b = this.a;
                this.advancePc(1);
                break;
            case 0xCB: // CB-prefixed instructions
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for CB-prefixed instruction");
                }
                this.executeCbPrefixed(nextByte);
                this.advancePc(2);
                break;
            case 0x20: { // JR NZ, r8
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for JR NZ, r8 instruction");
                }
                if (!this.flags.z) {
                    const offset = this.toSigned8(nextByte);
                    this.pc = (this.pc + 2 + offset) & 0xFFFF;
                } else {
                    this.advancePc(2);
                }
                break;
            }
            case 0xC9: // RET
                this.pc = this.memory.readWord(this.sp);
                this.sp = (this.sp + 2) & 0xFFFF;
                break;
            case 0xC0: // RET NZ
                if (!this.flags.z) {
                    this.pc = this.memory.readWord(this.sp);
                    this.sp = (this.sp + 2) & 0xFFFF;
                } else {
                    this.advancePc(1);
                }
                break;
            case 0x21: // LD HL, d16
                if (lowByte === undefined || highByte === undefined) {
                    throw new Error("Expected two bytes for LD HL, d16 instruction");
                }
                this.h = highByte;
                this.l = lowByte;
                this.advancePc(3);
                break;
            case 0x31: // LD SP, d16
                if (lowByte === undefined || highByte === undefined) {
                    throw new Error("Expected two bytes for LD SP, d16 instruction");
                }
                this.sp = (highByte << 8) | lowByte;
                this.advancePc(3);
                break;
            case 0x33: // INC SP
                this.sp = (this.sp + 1) & 0xFFFF;
                this.advancePc(1);
                break;
            case 0x32: { // LD (HL-), A
                const address = (this.h << 8) | this.l;
                this.memory.writeByte(address, this.a);
                const nextHl = (address - 1) & 0xFFFF;
                this.h = (nextHl >> 8) & 0xFF;
                this.l = nextHl & 0xFF;
                this.advancePc(1);
                break;
            }
            case 0x3A: { // LD A, (HL-)
                const address = (this.h << 8) | this.l;
                this.a = this.memory.readByte(address);
                const nextHl = (address - 1) & 0xFFFF;
                this.h = (nextHl >> 8) & 0xFF;
                this.l = nextHl & 0xFF;
                this.advancePc(1);
                break;
            }
            case 0xE2: { // LD (C), A
                const address = 0xFF00 + this.c;
                this.memory.writeByte(address, this.a);
                this.advancePc(1);
                break;
            }
            case 0xF2: { // LD A, (C)
                const address = 0xFF00 + this.c;
                this.a = this.memory.readByte(address);
                this.advancePc(1);
                break;
            }
            case 0x77: { // LD (HL), A
                const address = (this.h << 8) | this.l;
                this.memory.writeByte(address, this.a);
                this.advancePc(1);
                break;
            }
            case 0x23: { // INC HL
                const value = ((this.h << 8) | this.l) + 1;
                this.h = (value >> 8) & 0xFF;
                this.l = value & 0xFF;
                this.advancePc(1);
                break;
            }
            case 0x2B: { // DEC HL
                const value = (((this.h << 8) | this.l) - 1) & 0xFFFF;
                this.h = (value >> 8) & 0xFF;
                this.l = value & 0xFF;
                this.advancePc(1);
                break;
            }
            case 0x2A: { // LD A, (HL+)
                const address = (this.h << 8) | this.l;
                this.a = this.memory.readByte(address);
                const nextHl = (address + 1) & 0xFFFF;
                this.h = (nextHl >> 8) & 0xFF;
                this.l = nextHl & 0xFF;
                this.advancePc(1);
                break;
            }
            case 0xe6: // AND A, d8
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for AND A, d8 instruction");
                }
                this.a = this.a & nextByte;
                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: true,
                    c: false,
                });
                this.advancePc(2);
                break;
            case 0x01: // LD BC, d16
                if (lowByte === undefined || highByte === undefined) {
                    throw new Error("Expected two bytes for LD BC, d16 instruction");
                }

                this.b = highByte;
                this.c = lowByte;
                this.advancePc(3);
                break;
            case 0x36: { // LD (HL), d8
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for LD (HL), d8 instruction");
                }
                const address = (this.h << 8) | this.l;
                this.memory.writeByte(address, nextByte);
                this.advancePc(2);
                break;
            }
            case 0x0B: { // DEC BC
                const value = ((this.b << 8) | this.c) - 1;
                this.b = (value >> 8) & 0xFF;
                this.c = value & 0xFF;
                this.advancePc(1);
                break;
            }
            case 0xB1: // OR A, C
                this.a = this.a | this.c;
                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: false,
                    c: false,
                });
                this.advancePc(1);
                break;
            case 0xD5: { // PUSH DE
                this.sp = (this.sp - 2) & 0xFFFF;
                const value = (this.d << 8) | this.e;
                this.memory.writeWord(this.sp, value);
                this.advancePc(1);
                break;
            }
            case 0x57: // LD D, A
                this.d = this.a;
                this.advancePc(1);
                break;
            case 0x22: { // LD (HL+), A
                const address = (this.h << 8) | this.l;
                this.memory.writeByte(address, this.a);
                const nextHl = (address + 1) & 0xFFFF;
                this.h = (nextHl >> 8) & 0xFF;
                this.l = nextHl & 0xFF;

                this.advancePc(1);
                break;
            }
            case 0xD1: { // POP DE
                const value = this.memory.readWord(this.sp);
                this.d = (value >> 8) & 0xFF;
                this.e = value & 0xFF;
                this.sp = (this.sp + 2) & 0xFFFF;
                this.advancePc(1);
                break;
            }
            case 0xD0: // RET NC
                if (!this.flags.c) {
                    this.pc = this.memory.readWord(this.sp);
                    this.sp = (this.sp + 2) & 0xFFFF;
                } else {
                    this.advancePc(1);
                }
                break;
            case 0x11: // LD DE,d16
                if (lowByte === undefined || highByte === undefined) {
                    throw new Error("Expected two bytes for LD DE, d16 instruction");
                }
                this.d = highByte;
                this.e = lowByte;
                this.advancePc(3);
                break;
            case 0x6B: // LD L, E
                this.l = this.e;
                this.advancePc(1);
                break;
            case 0x1D: // DEC E
                this.e = this.decrement8(this.e);
                this.advancePc(1);
                break;
            case 0x15: // DEC D
                this.d = this.decrement8(this.d);
                this.advancePc(1);
                break;
            case 0x03: { // INC BC
                const value = (((this.b << 8) | this.c) + 1) & 0xFFFF;
                this.b = (value >> 8) & 0xFF;
                this.c = value & 0xFF;

                this.advancePc(1);
                break;
            }
            case 0x09: { // ADD HL, BC
                const hl = (this.h << 8) | this.l;
                const value = (this.b << 8) | this.c;
                const fullResult = hl + value;
                const result = fullResult & 0xFFFF;

                this.h = (result >> 8) & 0xFF;
                this.l = result & 0xFF;

                this.setFlags({
                    n: false,
                    h: ((hl & 0x0FFF) + (value & 0x0FFF)) > 0x0FFF,
                    c: fullResult > 0xFFFF,
                });

                this.advancePc(1);
                break;
            }
            case 0x0F: { // RRCA
                const carry = this.a & 0x01;

                this.a = ((this.a >> 1) | (carry << 7)) & 0xFF;

                this.setFlags({
                    z: false,
                    n: false,
                    h: false,
                    c: carry === 1,
                });

                this.advancePc(1);
                break;
            }
            case 0x12: {
                const address = (this.d << 8) | this.e;

                this.memory.writeByte(address, this.a);

                this.advancePc(1);
                break;
            }
            case 0x1B: {
                const value = (((this.d << 8) | this.e) - 1) & 0xFFFF;

                this.d = (value >> 8) & 0xFF;
                this.e = value & 0xFF;

                this.advancePc(1);
                break;
            }
            case 0x24: // INC H
                this.h = this.increment8(this.h);
                this.advancePc(1);
                break;
            case 0xE5: { // PUSH HL
                const value = (this.h << 8) | this.l;
                this.sp = (this.sp - 2) & 0xFFFF;
                this.memory.writeWord(this.sp, value);
                this.advancePc(1);
                break;
            }
            case 0xE1: { // POP HL
                const value = this.memory.readWord(this.sp);
                this.l = value & 0xFF;
                this.h = (value >> 8) & 0xFF;
                this.sp = (this.sp + 2) & 0xFFFF;
                this.advancePc(1);
                break;
            }
            case 0xF1: { // POP AF
                const value = this.memory.readWord(this.sp);
                this.a = (value >> 8) & 0xFF;
                this.f = value & 0xF0;
                this.flags = {
                    z: (this.f & 0x80) !== 0,
                    n: (this.f & 0x40) !== 0,
                    h: (this.f & 0x20) !== 0,
                    c: (this.f & 0x10) !== 0,
                };
                this.sp = (this.sp + 2) & 0xFFFF;
                this.advancePc(1);
                break;
            }
            case 0xF5: { // PUSH AF
                const value = (this.a << 8) | this.f;
                this.sp = (this.sp - 2) & 0xFFFF;
                this.memory.writeWord(this.sp, value);

                this.advancePc(1);
                break;
            }
            case 0xF9: // LD SP, HL
                this.sp = (this.h << 8) | this.l;
                this.advancePc(1);
                break;
            case 0xC5: { // PUSH BC
                const value = (this.b << 8) | this.c;

                this.sp = (this.sp - 2) & 0xFFFF;
                this.memory.writeWord(this.sp, value);

                this.advancePc(1);
                break;
            }
            case 0xFA: { // LD A, (a16)
                if (lowByte !== undefined && highByte !== undefined) {
                    const address = (highByte << 8) | lowByte;
                    this.a = this.memory.readByte(address);

                    this.advancePc(3);
                    break;
                } else {
                    throw new Error("Expected two bytes for LD A, (a16) instruction");
                }
            }
            case 0xA7: // AND A
                this.a = this.a & this.a;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: true,
                    c: false
                });

                this.advancePc(1);
                break;
            case 0x1A: { // LD A, (DE)
                const address = (this.d << 8) | this.e;
                this.a = this.memory.readByte(address);
                this.advancePc(1);
                break;
            }
            case 0xC8: // RET Z
                if(this.flags.z) {
                    this.pc = this.memory.readWord(this.sp);
                    this.sp = (this.sp + 2) & 0xFFFF;
                } else {
                    this.advancePc(1);
                }

                break;
            case 0xC1: { // POP BC
                const value = this.memory.readWord(this.sp);

                this.b = (value >> 8) & 0xFF;
                this.c = value & 0xFF;
                this.sp = (this.sp + 2) & 0xFFFF;

                this.advancePc(1);
                break;
            }
            case 0x02: { // LD (BC), A
                const address = (this.b << 8) | this.c;

                this.memory.writeByte(address, this.a);

                this.advancePc(1);
                break;
            }
            case 0x08: { // LD (a16), SP
                if (lowByte === undefined || highByte === undefined) {
                    throw new Error("Expected two bytes for LD (a16), SP instruction");
                }
                const address = (highByte << 8) | lowByte;
                this.memory.writeWord(address, this.sp);
                this.advancePc(3);
                break;
            }
            case 0x40: // LD B, B
                this.advancePc(1);
                break;
            case 0x9F: { // SBC A, A
                const carry = this.flags.c ? 1 : 0;
                const originalA = this.a;
                const result = originalA - originalA - carry;
                this.a = result & 0xFF;
                this.setFlags({
                    z: this.a === 0,
                    n: true,
                    h: (originalA & 0x0F) < ((originalA & 0x0F) + carry),
                    c: result < 0,
                });
                this.advancePc(1);
                break;
            }
            case 0xCF: // RST 08H
                this.sp = (this.sp - 2) & 0xFFFF;
                this.memory.writeWord(this.sp, (this.pc + 1) & 0xFFFF);
                this.pc = 0x0008;
                break;
            case 0x39: { // ADD HL, SP
                const hl = (this.h << 8) | this.l;
                const sp = this.sp;
                const fullResult = hl + sp;
                const result = fullResult & 0xFFFF;

                this.h = (result >> 8) & 0xFF;
                this.l = result & 0xFF;

                this.setFlags({
                    n: false,
                    h: ((hl & 0x0FFF) + (sp & 0x0FFF)) > 0x0FFF,
                    c: fullResult > 0xFFFF,
                });

                this.advancePc(1);
                break;
            }
            case 0x42: // LD B, D
                this.b = this.d;
                this.advancePc(1);
                break;
            case 0x71: { // LD (HL), C
                const address = (this.h << 8) | this.l;
                this.memory.writeByte(address, this.c);
                this.advancePc(1);
                break;
            }
            case 0x5F: // LD E, A
                this.e = this.a;
                this.advancePc(1);
                break;
            case 0x19: { // ADD HL, DE
                const hl = (this.h << 8) | this.l;
                const value = (this.d << 8) | this.e;

                const fullResult = hl + value;
                const result = fullResult & 0xFFFF;

                this.h = (result >> 8) & 0xFF;
                this.l = result & 0xFF;

                this.setFlags({
                    n: false,
                    h: ((hl & 0x0FFF) + (value & 0x0FFF)) > 0x0FFF,
                    c: fullResult > 0xFFFF
                });

                this.advancePc(1);
                break;
            }
            case 0x54: // LD D, H
                this.d = this.h;
                this.advancePc(1);
                break;
            case 0x5D: // LD E, L
                this.e = this.l;
                this.advancePc(1);
                break;
            case 0x13: { // INC DE
                const value = (((this.d << 8) | this.e) + 1) & 0xFFFF;
                this.d = (value >> 8) & 0xFF;
                this.e = value & 0xFF;

                this.advancePc(1);
                break;
            }
            case 0x6F: // LD L, A
                this.l = this.a;
                this.advancePc(1);
                break;
            case 0x67: // LD H, A
                this.h = this.a;
                this.advancePc(1);
                break;
            case 0x7E: { // LD A, (HL)
                const address = (this.h << 8) | this.l;
                this.a = this.memory.readByte(address);
                this.advancePc(1);
                break;
            }
            case 0xB3: // OR A, E
                this.a = this.a | this.e;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: false,
                    c: false
                });

                this.advancePc(1);
                break;
            case 0x37: // SCF
                this.setFlags({
                    c: true,
                    n: false,
                    h: false,
                });

                this.advancePc(1);
                break;
            case 0x66: { // LD H, (HL)
                const address = (this.h << 8) | this.l;
                this.h = this.memory.readByte(address);
                this.advancePc(1);
                break;
            }
            case 0xB0: // OR A, B
                this.a |= this.b;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: false,
                    c: false
                });

                this.advancePc(1);
                break;
            case 0x4F: // LD C, A
                this.c = this.a;
                this.advancePc(1);
                break;
            case 0x29: { // ADD HL, HL
                const hl = (this.h << 8) | this.l;
                const fullResult = hl + hl;
                const result = fullResult & 0xFFFF;
                this.h = (result >> 8) & 0xFF;
                this.l = result & 0xFF;

                this.setFlags({
                    n: false,
                    h: ((hl & 0x0FFF) + (hl & 0x0FFF)) > 0x0FFF,
                    c: fullResult > 0xFFFF,
                });

                this.advancePc(1);
                break;
            }
            case 0x76: // HALT
                this.halted = true;
                this.advancePc(1);
                break;
            case 0x88: { // ADC A, B
                const carry = this.flags.c ? 1 : 0;
                const originalA = this.a;
                const value = this.b;

                const result = originalA + value + carry;

                this.a = result & 0xFF;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: ((originalA & 0x0F) + (value & 0x0F) + carry) > 0x0F,
                    c: result > 0xFF
                });

                this.advancePc(1);
                break;
            }
            case 0x98: { // SBC A, B
                const carry = this.flags.c ? 1 : 0;
                const originalA = this.a;
                const value = this.b;

                const result = originalA - value - carry;

                this.a = result & 0xFF;

                this.setFlags({
                    z: this.a === 0,
                    n: true,
                    h: (originalA & 0x0F) < ((value & 0x0F) + carry),
                    c: originalA < (value + carry),
                });

                this.advancePc(1);
                break;
            }
            case 0xCC: { // CALL Z, a16
                if(lowByte === undefined || highByte === undefined){
                    throw new Error("Expected two bytes for CALL Z,a16");
                }

                if (this.flags.z) {
                    const address = (highByte << 8) | lowByte;

                    this.sp = (this.sp - 2) & 0xFFFF;
                    this.memory.writeWord(this.sp, (this.pc + 3) & 0xFFFF);

                    this.pc = address;
                } else {
                    this.advancePc(3);
                }

                break;
            }
            case 0xD9: { // RETI
                this.pc = this.memory.readWord(this.sp);
                this.sp = (this.sp + 2) & 0xFFFF;

                this.ime = true;

                break;
            }
            case 0x2F: { // CPL
                this.a = (~this.a) & 0xFF;

                this.setFlags({
                    n: true,
                    h: true,
                });

                this.advancePc(1);
                break;

            }
            case 0xF8: { // LD HL, SP + r8
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for LD HL,SP+r8");
                }

                const offset = this.toSigned8(nextByte);

                const sp = this.sp;
                const result = (sp + offset) & 0xFFFF;

                this.h = (result >> 8) & 0xFF;
                this.l = result & 0xFF;

                this.setFlags({
                    z: false,
                    n: false,
                    h: ((sp & 0x0F) + (offset & 0x0F)) > 0x0F,
                    c: ((sp & 0xFF) + (offset & 0xFF)) > 0xFF,
                });

                this.advancePc(2);
                break;
            }
            case 0x73: { //LD (HL), E.
                const hl = (this.h << 8) | this.l;

                this.memory.writeByte(hl, this.e);

                this.advancePc(1);
                break;
            }
            case 0x2C: { // INC L
                this.l = this.increment8(this.l);
                this.advancePc(1);
                break; 
            }
            case 0x72: { // LD (HL), D.
                const hl = (this.h << 8) | this.l;

                this.memory.writeByte(hl, this.d);

                this.advancePc(1);
                break;
            }
            case 0xD6: { // SUB d8
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for SUB d8");
                }

                this.subtractFromA(nextByte);
                this.advancePc(2);
                break;
            }
            case 0x44: { //LD B, H
                this.b = this.h;
                this.advancePc(1);
                break;
            }
            case 0x4D: { //LD C, L
                this.c = this.l;
                this.advancePc(1);
                break;
            }
            case 0x07: { // RLCA
                const carry = (this.a & 0x80) !== 0;

                this.a = ((this.a << 1) | (carry ? 1 : 0)) & 0xFF;

                this.setFlags({
                    z: false,
                    n: false,
                    h: false,
                    c: carry,
                });

                this.advancePc(1);
                break;
            }
            case 0x51: { // LD D, C
                this.d = this.c;
                this.advancePc(1);
                break;
            }
            case 0x4A: { // LD C, D
                this.c = this.d;
                this.advancePc(1);
                break;
            }
            case 0x62: { // LD H, D
                this.h = this.d;
                this.advancePc(1);
                break;
            }
            case 0x41: { // LD B, C
                this.b = this.c;
                this.advancePc(1);
                break;
            }
            case 0xB9: { // CP A, C
                this.compareWithA(this.c);
                this.advancePc(1);
                break;

            }
            case 0x38: { // JR C, r8
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for JR C,r8");
                }

                if (this.flags.c) {
                    const offset = this.toSigned8(nextByte);
                    this.pc = (this.pc + 2 + offset) & 0xFFFF;
                } else {
                    this.advancePc(2);
                }

                break;
            }
            case 0x6C: { // LD L, H
                this.l = this.h;
                this.advancePc(1);
                break;

            }
            case 0xC6: { // ADD A, d8
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for ADD A,d8");
                }

                this.addToA(nextByte);
                this.advancePc(2);
                break;
            }
            case 0x3F: { // CCF
                this.setFlags({
                    n: false,
                    h: false,
                    c: !this.flags.c,
                });

                this.advancePc(1);
                break;
            }
            case 0xB2: { // OR A,D
                this.a |= this.d;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: false,
                    c: false,
                });

                this.advancePc(1);
                break;
            }
            case 0xB6: { // OR A,(HL)
                const value = this.memory.readByte(this.getHlAddress());

                this.a |= value;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: false,
                    c: false,
                });

                this.advancePc(1);
                break;
            }
            case 0xF6: { // OR A,d8
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for OR A,d8");
                }

                this.a |= nextByte;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: false,
                    c: false,
                });

                this.advancePc(2);
                break;
            }
            case 0xA8: {
                this.a ^= this.b;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: false,
                    c: false,
                });

                this.advancePc(1);
                break;
            }
            case 0xA3: { // AND A,E
                this.a &= this.e;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: true,
                    c: false,
                });

                this.advancePc(1);
                break;
            }
            case 0xA0: { // AND A,B
                this.a &= this.b;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: true,
                    c: false,
                });

                this.advancePc(1);
                break;
            }
            case 0xD8: { // RET C
                if (this.flags.c) {
                    this.pc = this.memory.readWord(this.sp);
                    this.sp = (this.sp + 2) & 0xFFFF;
                } else {
                    this.advancePc(1);
                }

                break;
            }
            case 0xEE: { // XOR A,d8
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for XOR A,d8");
                }

                this.a ^= nextByte;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: false,
                    c: false,
                });

                this.advancePc(2);
                break;
            }
            case 0xA6: { // AND A,(HL)
                const value = this.memory.readByte(this.getHlAddress());

                this.a &= value;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: true,
                    c: false,
                });

                this.advancePc(1);
                break;
            }
            case 0x35: { // DEC (HL)
                const address = this.getHlAddress();

                const value = this.memory.readByte(address);
                const result = this.decrement8(value);

                this.memory.writeByte(address, result);

                this.advancePc(1);
                break;
            }
            case 0x14: { // INC D
                this.d = this.increment8(this.d);
                this.advancePc(1);
                break;
            }
            case 0x86: { // ADD A,(HL)
                const value = this.memory.readByte(this.getHlAddress());

                this.addToA(value);

                this.advancePc(1);
                break;
            }
            case 0x1C: { // INC E
                this.e = this.increment8(this.e);
                this.advancePc(1);
                break;
            }
            case 0xB8: { // CP A,B
                this.compareWithA(this.b);
                this.advancePc(1);
                break;
            }
            case 0x0A: { // LD A,(BC)
                const address = (this.b << 8) | this.c;

                this.a = this.memory.readByte(address);

                this.advancePc(1);
                break;
            }
            case 0xBD: { // CP A,L
                this.compareWithA(this.l);
                this.advancePc(1);
                break;
            }
            case 0xBC: { // CP A,H
                this.compareWithA(this.h);
                this.advancePc(1);
                break;
            }
            case 0xBE: { // CP A,(HL)
                const value = this.memory.readByte(this.getHlAddress());

                this.compareWithA(value);

                this.advancePc(1);
                break;
            }
            case 0xBB: { // CP A,E
                this.compareWithA(this.e);
                this.advancePc(1);
                break;
            }
            case 0x96: { // SUB A,(HL)
                const value = this.memory.readByte(this.getHlAddress());

                this.subtractFromA(value);

                this.advancePc(1);
                break;
            }
            case 0x34: { // INC (HL)
                const address = this.getHlAddress();

                const value = this.memory.readByte(address);
                const result = this.increment8(value);

                this.memory.writeByte(address, result);

                this.advancePc(1);
                break;
            }
            case 0xDE: { // SBC A,d8
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for SBC A,d8");
                }

                const carry = this.flags.c ? 1 : 0;
                const originalA = this.a;
                const value = nextByte;

                const result = originalA - value - carry;

                this.a = result & 0xFF;

                this.setFlags({
                    z: this.a === 0,
                    n: true,
                    h: (originalA & 0x0F) < ((value & 0x0F) + carry),
                    c: originalA < (value + carry),
                });

                this.advancePc(2);
                break;
            }
            case 0xAB: { // XOR A,E
                this.a ^= this.e;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: false,
                    c: false,
                });

                this.advancePc(1);
                break;
            }
            case 0x25: { // DEC H
                this.h = this.decrement8(this.h);
                this.advancePc(1);
                break;
            }
            case 0x99: { // SBC A,C
                const carry = this.flags.c ? 1 : 0;
                const originalA = this.a;
                const value = this.c;

                const result = originalA - value - carry;

                this.a = result & 0xFF;

                this.setFlags({
                    z: this.a === 0,
                    n: true,
                    h: (originalA & 0x0F) < ((value & 0x0F) + carry),
                    c: originalA < (value + carry),
                });

                this.advancePc(1);
                break;
            }
            case 0xC4: { // CALL NZ,a16
                if (lowByte === undefined || highByte === undefined) {
                    throw new Error("Expected two bytes for CALL NZ,a16");
                }

                if (!this.flags.z) {
                    const address = (highByte << 8) | lowByte;

                    this.sp = (this.sp - 2) & 0xFFFF;
                    this.memory.writeWord(this.sp, (this.pc + 3) & 0xFFFF);

                    this.pc = address;
                } else {
                    this.advancePc(3);
                }

                break;
            }
            case 0xBA: { // CP A,D
                this.compareWithA(this.d);
                this.advancePc(1);
                break;
            }
            case 0xA2: { // AND A,D
                this.a &= this.d;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: true,
                    c: false,
                });

                this.advancePc(1);
                break;
            }
            case 0xD4: { // CALL NC,a16
                if (lowByte === undefined || highByte === undefined) {
                    throw new Error("Expected two bytes for CALL NC,a16");
                }

                if (!this.flags.c) {
                    const address = (highByte << 8) | lowByte;

                    this.sp = (this.sp - 2) & 0xFFFF;
                    this.memory.writeWord(this.sp, (this.pc + 3) & 0xFFFF);

                    this.pc = address;
                } else {
                    this.advancePc(3);
                }

                break;
            }
            case 0xB5: { // OR A,L
                this.a |= this.l;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: false,
                    c: false,
                });

                this.advancePc(1);
                break;
            }
            case 0xB4: { // OR A,H
                this.a |= this.h;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: false,
                    c: false,
                });

                this.advancePc(1);
                break;
            }
            case 0x89: { // ADC A,C
                const carry = this.flags.c ? 1 : 0;
                const originalA = this.a;
                const value = this.c;

                const result = originalA + value + carry;

                this.a = result & 0xFF;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: ((originalA & 0x0F) + (value & 0x0F) + carry) > 0x0F,
                    c: result > 0xFF,
                });

                this.advancePc(1);
                break;
            }
            case 0x8E: { // ADC A,(HL)
                const carry = this.flags.c ? 1 : 0;
                const originalA = this.a;
                const value = this.memory.readByte(this.getHlAddress());

                const result = originalA + value + carry;

                this.a = result & 0xFF;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: ((originalA & 0x0F) + (value & 0x0F) + carry) > 0x0F,
                    c: result > 0xFF,
                });

                this.advancePc(1);
                break;
            }
            case 0x27: { // DAA
                let correction = 0;

                if (!this.flags.n) {
                    if (this.flags.h || (this.a & 0x0F) > 0x09) {
                        correction |= 0x06;
                    }

                    if (this.flags.c || this.a > 0x99) {
                        correction |= 0x60;
                        this.flags.c = true;
                    }

                    this.a = (this.a + correction) & 0xFF;
                } else {
                    if (this.flags.h) {
                        correction |= 0x06;
                    }

                    if (this.flags.c) {
                        correction |= 0x60;
                    }

                    this.a = (this.a - correction) & 0xFF;
                }

                this.setFlags({
                    z: this.a === 0,
                    h: false,
                    c: this.flags.c,
        
                });

                this.advancePc(1);
                break;
            }
            case 0x17: { // RLA
                const carryIn = this.flags.c ? 1 : 0;
                const carryOut = (this.a & 0x80) !== 0;

                this.a = ((this.a << 1) | carryIn) & 0xFF;

                this.setFlags({
                    z: false,
                    n: false,
                    h: false,
                    c: carryOut,
                });

                this.advancePc(1);
                break;
            }
            case 0xDC: { // CALL C,a16
                if (lowByte === undefined || highByte === undefined) {
                    throw new Error("Expected two bytes for CALL C,a16");
                }

                if (this.flags.c) {
                    const address = (highByte << 8) | lowByte;

                    this.sp = (this.sp - 2) & 0xFFFF;
                    this.memory.writeWord(this.sp, (this.pc + 3) & 0xFFFF);

                    this.pc = address;
                } else {
                    this.advancePc(3);
                }

                break;
            }
            case 0xB7: { // OR A,A
                this.a |= this.a;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: false,
                    c: false,
                });

                this.advancePc(1);
                break;
            }
            case 0x9A: { // SBC A,D
                const carry = this.flags.c ? 1 : 0;
                const originalA = this.a;
                const value = this.d;

                const result = originalA - value - carry;

                this.a = result & 0xFF;

                this.setFlags({
                    z: this.a === 0,
                    n: true,
                    h: (originalA & 0x0F) < ((value & 0x0F) + carry),
                    c: originalA < (value + carry),
                });

                this.advancePc(1);
                break;
            }
            case 0x8A: { // ADC A,D
                const carry = this.flags.c ? 1 : 0;
                const originalA = this.a;
                const value = this.d;

                const result = originalA + value + carry;

                this.a = result & 0xFF;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: ((originalA & 0x0F) + (value & 0x0F) + carry) > 0x0F,
                    c: result > 0xFF,
                });

                this.advancePc(1);
                break;
            }
            case 0xA9: { // XOR A,C
                this.a ^= this.c;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: false,
                    c: false,
                });

                this.advancePc(1);
                break;
            }
            case 0x2D: { // DEC L
                this.l = this.decrement8(this.l);
                this.advancePc(1);
                break;
            }
            case 0xAE: { // XOR A,(HL)
                const value = this.memory.readByte(this.getHlAddress());

                this.a ^= value;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: false,
                    c: false,
                });

                this.advancePc(1);
                break;
            }
            case 0xA1: { // AND A,C
                this.a &= this.c;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: true,
                    c: false,
                });

                this.advancePc(1);
                break;
            }
            case 0xEF: { // RST 28H
                this.sp = (this.sp - 2) & 0xFFFF;
                this.memory.writeWord(this.sp, (this.pc + 1) & 0xFFFF);
                this.pc = 0x0028;
                break;
            }
            case 0x9E: { // SBC A,(HL)
                const carry = this.flags.c ? 1 : 0;
                const originalA = this.a;
                const value = this.memory.readByte(this.getHlAddress());

                const result = originalA - value - carry;

                this.a = result & 0xFF;

                this.setFlags({
                    z: this.a === 0,
                    n: true,
                    h: (originalA & 0x0F) < ((value & 0x0F) + carry),
                    c: originalA < (value + carry),
                });

                this.advancePc(1);
                break;
            }
            case 0xAA: { // XOR A,D
                this.a ^= this.d;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: false,
                    c: false,
                });

                this.advancePc(1);
                break;
            }
            case 0x8B: { // ADC A,E
                const carry = this.flags.c ? 1 : 0;
                const originalA = this.a;
                const value = this.e;

                const result = originalA + value + carry;

                this.a = result & 0xFF;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: ((originalA & 0x0F) + (value & 0x0F) + carry) > 0x0F,
                    c: result > 0xFF,
                });

                this.advancePc(1);
                break;
            }
            case 0x1F: { // RRA
                const carryIn = this.flags.c ? 1 : 0;
                const carryOut = (this.a & 0x01) !== 0;

                this.a = ((this.a >>> 1) | (carryIn << 7)) & 0xFF;

                this.setFlags({
                    z: false,
                    n: false,
                    h: false,
                    c: carryOut,
                });

                this.advancePc(1);
                break;
            }
            case 0x10: { // STOP 0
                if (nextByte !== 0x00) {
                    console.warn(`STOP with non-zero padding: 0x${nextByte?.toString(16)}`);
                }

                this.memory.handleStopModeSwitch();
                this.advancePc(2);
                break;
            }
            case 0xCE: { // ADC A,d8
                if (nextByte === undefined) {
                    throw new Error("Expected next byte for ADC A,d8");
                }

                const carry = this.flags.c ? 1 : 0;
                const originalA = this.a;
                const value = nextByte;

                const result = originalA + value + carry;

                this.a = result & 0xFF;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: ((originalA & 0x0F) + (value & 0x0F) + carry) > 0x0F,
                    c: result > 0xFF,
                });

                this.advancePc(2);
                break;
            }
            case 0xD7: { // RST 10H
                this.sp = (this.sp - 2) & 0xFFFF;
                this.memory.writeWord(this.sp, (this.pc + 1) & 0xFFFF);

                this.pc = 0x0010;
                break;
            }
            case 0x8C: { // ADC A,H
                const carry = this.flags.c ? 1 : 0;
                const originalA = this.a;
                const value = this.h;

                const result = originalA + value + carry;

                this.a = result & 0xFF;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: ((originalA & 0x0F) + (value & 0x0F) + carry) > 0x0F,
                    c: result > 0xFF,
                });

                this.advancePc(1);
                break;
            }
            case 0x8F: { // ADC A,A
                const carry = this.flags.c ? 1 : 0;
                const originalA = this.a;
                const value = this.a;

                const result = originalA + value + carry;

                this.a = result & 0xFF;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: ((originalA & 0x0F) + (value & 0x0F) + carry) > 0x0F,
                    c: result > 0xFF,
                });

                this.advancePc(1);
                break;
            }
            default: // Unknown opcode
                throw new Error(`Unknown opcode. ${this.formatCpuContext(opcode)}`);
        }

        // Handle IME scheduling after instruction execution
        if (wasIMEScheduled) {
            this.ime = true;
            this.imeScheduled = false;
        }
    }

    executeCbPrefixed(opcode: number) {
        if (opcode >= 0x40 && opcode <= 0x7F) {
            const bit = (opcode >> 3) & 0x07;
            const registerCode = opcode & 0x07;
            const value = this.getRegByCode(registerCode);

            this.setFlags({
                z: (value & (1 << bit)) === 0,
                n: false,
                h: true,
            });
            return;
        }

        if (opcode >= 0x80 && opcode <= 0xBF) {
            const bit = (opcode >> 3) & 0x07;
            const registerCode = opcode & 0x07;
            const value = this.getRegByCode(registerCode) & ~(1 << bit);

            this.setRegByCode(registerCode, value);
            return;
        }

        if (opcode >= 0xC0 && opcode <= 0xFF) {
            const bit = (opcode >> 3) & 0x07;
            const registerCode = opcode & 0x07;
            const value = this.getRegByCode(registerCode) | (1 << bit);

            this.setRegByCode(registerCode, value);
            return;
        }

        switch (opcode) {
            case 0x11: { // RL C
                const carryIn = this.flags.c ? 1 : 0;
                const carryOut = (this.c & 0x80) !== 0;
                const newC = ((this.c << 1) | carryIn) & 0xFF;

                this.c = newC;
                this.setFlags({
                    z: newC === 0,
                    n: false,
                    h: false,
                    c: carryOut,
                });
                break;
            }
            case 0x87: // RES 0, A
                this.a &= ~(1 << 0);
                break;
            case 0x42: // BIT 0, D
                this.setFlags({
                    z: (this.d & 0x01) === 0,
                    n: false,
                    h: true,
                });
                break;
            case 0x1A: { // RR D
                const dCarryIn = this.flags.c ? 1 : 0;
                const dCarryOut = (this.d & 0x01) !== 0;

                this.d = ((this.d >> 1) | (dCarryIn << 7)) & 0xFF;

                this.setFlags({
                    z: this.d === 0,
                    n: false,
                    h: false,
                    c: dCarryOut,
                });

                break;
            }
            case 0x4F: { // BIT 1, A
                this.setFlags({
                    z: (this.a & (1 << 1)) === 0,
                    n: false,
                    h: true,
                });
                break;
            }
            case 0x47: { // BIT 0, A
                this.setFlags({
                    z: (this.a & 0x01) === 0,
                    n: false,
                    h: true,
                });
                break;
            }
            case 0x37: { // SWAP A
                this.a = ((this.a & 0x0F) << 4) | ((this.a & 0xF0) >> 4);

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: false,
                    c: false,
                });

                break;
            }
            case 0x7F: { // BIT 7, A.
                this.setFlags({
                    z: (this.a & 0x80) === 0,
                    n: false,
                    h: true,
                });
                break;
            }
            case 0x77: { // BIT 6, A
                this.setFlags({
                    z: (this.a & 0x40) === 0,
                    n: false,
                    h: true,
                });
                break;
            }
            case 0x57: { // BIT 2, A.
                this.setFlags({
                    z: (this.a & 0x04) === 0,
                    n: false,
                    h: true,
                });
                break;
            }
            case 0xFF: { // SET 7,A
                this.a |= 0x80;
                break;
            }
            case 0xAE: { // RES 5,(HL)
                 const hl = (this.h << 8) | this.l;

                let value = this.memory.readByte(hl);

                value &= ~(1 << 5);

                this.memory.writeByte(hl, value);

                break;
            }
            case 0xDE: { //SET 3,(HL) 
                const hl = (this.h << 8) | this.l;

                const value = this.memory.readByte(hl);
                this.memory.writeByte(hl, value | (1 << 3));

                break;    
            }
            case 0x8F: { // RES 1,A
                this.a &= ~(1 << 1);
                break;
            }
            case 0x97: { // RES 2,A
                this.a &= ~(1 << 2);
                break;
            }
            case 0x6F: { // BIT 5,A
                this.setFlags({
                    z: (this.a & 0x20) === 0,
                    n: false,
                    h: true,
                });
                break;
            }
            case 0xAF: { // RES 5, A
                this.a &= ~(1 << 5);
                break;
            }
            case 0x3F: { // SRL A
                const carry = (this.a & 0x01) !== 0;

                this.a >>= 1;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: false,
                    c: carry
                });

                break;
            }
            case 0x23: { // SLA E
                const carry = (this.e & 0x80) !== 0;

                this.e = (this.e << 1) & 0xFF;

                this.setFlags({
                    z: this.e === 0,
                    n: false,
                    h: false,
                    c: carry,
                });

                break;
            }
            case 0x12: { // RL D
                const carryIn = this.flags.c ? 1 : 0;
                const carryOut = (this.d & 0x80) !== 0;

                this.d = ((this.d << 1) | carryIn) & 0xFF;

                this.setFlags({
                    z: this.d === 0,
                    n: false,
                    h: false,
                    c: carryOut,
                });

                break;
            }
            case 0x27: { // SLA A
                const carry = (this.a & 0x80) !== 0;

                this.a = (this.a << 1) & 0xFF;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: false,
                    c: carry,
                });

                break;
            }
            case 0x36: { // SWAP (HL)
                const address = this.getHlAddress();

                const value = this.memory.readByte(address);

                const result =
                    ((value & 0x0F) << 4) |
                    ((value & 0xF0) >> 4);

                this.memory.writeByte(address, result);

                this.setFlags({
                    z: result === 0,
                    n: false,
                    h: false,
                    c: false,
                });

                break;
            }
            case 0x2A: { // SRA D
                const carry = (this.d & 0x01) !== 0;
                const bit7 = this.d & 0x80;

                this.d = ((this.d >>> 1) | bit7) & 0xFF;

                this.setFlags({
                    z: this.d === 0,
                    n: false,
                    h: false,
                    c: carry,
                });

                break;
            }
            case 0x1B: { // RR E
                const carryIn = this.flags.c ? 1 : 0;
                const carryOut = (this.e & 0x01) !== 0;

                this.e = ((this.e >>> 1) | (carryIn << 7)) & 0xFF;

                this.setFlags({
                    z: this.e === 0,
                    n: false,
                    h: false,
                    c: carryOut,
                });

                break;
            }
            case 0x0B: { // RRC E
                const carry = (this.e & 0x01) !== 0;

                this.e = ((this.e >>> 1) | (carry ? 0x80 : 0)) & 0xFF;

                this.setFlags({
                    z: this.e === 0,
                    n: false,
                    h: false,
                    c: carry,
                });

                break;
            }
            case 0x33: { // SWAP E
                this.e = ((this.e & 0x0F) << 4) | ((this.e & 0xF0) >>> 4);

                this.setFlags({
                    z: this.e === 0,
                    n: false,
                    h: false,
                    c: false,
                });

                break;
            }
            case 0x21: { // SLA C
                const carry = (this.c & 0x80) !== 0;

                this.c = (this.c << 1) & 0xFF;

                this.setFlags({
                    z: this.c === 0,
                    n: false,
                    h: false,
                    c: carry,
                });

                break;
            }
            case 0x0E: { // RRC (HL)
                const address = this.getHlAddress();

                const value = this.memory.readByte(address);

                const carry = (value & 0x01) !== 0;

                const result =
                    ((value >>> 1) | (carry ? 0x80 : 0)) & 0xFF;

                this.memory.writeByte(address, result);

                this.setFlags({
                    z: result === 0,
                    n: false,
                    h: false,
                    c: carry,
                });

                break;
            }
            case 0x22: { // SLA D
                const carry = (this.d & 0x80) !== 0;

                this.d = (this.d << 1) & 0xFF;

                this.setFlags({
                    z: this.d === 0,
                    n: false,
                    h: false,
                    c: carry,
                });

                break;
            }
            case 0x17: { // RL A
                const carryIn = this.flags.c ? 1 : 0;
                const carryOut = (this.a & 0x80) !== 0;

                this.a = ((this.a << 1) | carryIn) & 0xFF;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: false,
                    c: carryOut,
                });

                break;
            }
            case 0x1F: { // RR A
                const carryIn = this.flags.c ? 1 : 0;
                const carryOut = (this.a & 0x01) !== 0;

                this.a = ((this.a >>> 1) | (carryIn << 7)) & 0xFF;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: false,
                    c: carryOut,
                });

                break;
            }
            case 0x20: { // SLA B
                const carry = (this.b & 0x80) !== 0;

                this.b = (this.b << 1) & 0xFF;

                this.setFlags({
                    z: this.b === 0,
                    n: false,
                    h: false,
                    c: carry,
                });

                break;
            }
            case 0x3C: { // SRL H
                const carry = (this.h & 0x01) !== 0;

                this.h = this.h >>> 1;

                this.setFlags({
                    z: this.h === 0,
                    n: false,
                    h: false,
                    c: carry,
                });

                break;
            }
            case 0x31: { // SWAP C
                this.c =
                    ((this.c & 0x0F) << 4) |
                    ((this.c & 0xF0) >>> 4);

                this.setFlags({
                    z: this.c === 0,
                    n: false,
                    h: false,
                    c: false,
                });

                break;
            }
            case 0x39: { // SRL C
                const carry = (this.c & 0x01) !== 0;

                this.c = this.c >>> 1;

                this.setFlags({
                    z: this.c === 0,
                    n: false,
                    h: false,
                    c: carry,
                });

                break;
            }
            case 0x38: { // SRL B
                const carry = (this.b & 0x01) !== 0;

                this.b = this.b >>> 1;

                this.setFlags({
                    z: this.b === 0,
                    n: false,
                    h: false,
                    c: carry,
                });

                break;
            }
            case 0x10: { // RL B
                const carryIn = this.flags.c ? 1 : 0;
                const carryOut = (this.b & 0x80) !== 0;

                this.b = ((this.b << 1) | carryIn) & 0xFF;

                this.setFlags({
                    z: this.b === 0,
                    n: false,
                    h: false,
                    c: carryOut,
                });

                break;
            }
            case 0x18: { // RR B
                const carryIn = this.flags.c ? 1 : 0;
                const carryOut = (this.b & 0x01) !== 0;

                this.b = ((this.b >>> 1) | (carryIn << 7)) & 0xFF;

                this.setFlags({
                    z: this.b === 0,
                    n: false,
                    h: false,
                    c: carryOut,
                });

                break;
            }
            case 0x07: { // RLC A
                const carry = (this.a & 0x80) !== 0;

                this.a = ((this.a << 1) | (carry ? 1 : 0)) & 0xFF;

                this.setFlags({
                    z: this.a === 0,
                    n: false,
                    h: false,
                    c: carry,
                });

                break;
            }
            case 0x19: { // RR C
                const carryIn = this.flags.c ? 1 : 0;
                const carryOut = (this.c & 0x01) !== 0;

                this.c = ((this.c >>> 1) | (carryIn << 7)) & 0xFF;

                this.setFlags({
                    z: this.c === 0,
                    n: false,
                    h: false,
                    c: carryOut,
                });

                break;
            }
            case 0x3B: { // SRL E
                const carry = (this.e & 0x01) !== 0;

                this.e = this.e >>> 1;

                this.setFlags({
                    z: this.e === 0,
                    n: false,
                    h: false,
                    c: carry,
                });

                break;
            }
            case 0x3A: { // SRL D
                const carryOut = (this.d & 0x01) !== 0;

                this.d = (this.d >> 1) & 0xFF;

                this.setFlags({
                    z: this.d === 0,
                    n: false,
                    h: false,
                    c: carryOut,
                });

                break;
            }
            case 0x01: { // RLC C
                const carry = (this.c & 0x80) !== 0;

                this.c = ((this.c << 1) | (carry ? 1 : 0)) & 0xFF;

                this.setFlags({
                    z: this.c === 0,
                    n: false,
                    h: false,
                    c: carry,
                });

                break;
            }
            default:
                throw new Error(`Unknown CB opcode: 0x${opcode.toString(16)}`);
        }
    }
}
