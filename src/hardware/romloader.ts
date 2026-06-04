import * as fs from 'fs';

export class RomLoader {
    loadRom(romAddress: string): Uint8Array {
        const romData =fs.readFileSync(romAddress);
        return new Uint8Array(romData);
    }


}