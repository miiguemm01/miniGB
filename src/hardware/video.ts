import { Memory } from "./memory";

export const LCD_WIDTH = 160;
export const LCD_HEIGHT = 144;
export const TILE_SIZE = 8;
export const TILE_BYTES = 16;
export const TILESET_TILE_COUNT = 384;
export const TILESET_COLUMNS = 16;
export const TILESET_WIDTH = TILESET_COLUMNS * TILE_SIZE;
export const TILESET_HEIGHT = (TILESET_TILE_COUNT / TILESET_COLUMNS) * TILE_SIZE;

type RenderOptions = {
    applyPalette?: boolean;
    respectLcdEnable?: boolean;
};

type TilePixelResult = {
    colorIndex: number;
    rgba: [number, number, number, number];
    priority: boolean;
};

const DMG_SCREEN_COLORS: ReadonlyArray<[number, number, number, number]> = [
    [224, 248, 208, 255],
    [136, 192, 112, 255],
    [52, 104, 86, 255],
    [8, 24, 32, 255],
];

export class VideoRenderer {
    constructor(private readonly memory: Memory) {}

    renderScreen(options: RenderOptions = {}): Uint8Array {
        const frame = new Uint8Array(LCD_WIDTH * LCD_HEIGHT * 4);
        const lcdc = this.memory.peekByte(0xFF40);
        const isCgb = this.memory.isCgbModeEnabled();
        const isDmgColorized = !isCgb && this.memory.isDmgCompatibilityColorModeEnabled() && options.applyPalette !== false;
        const useColorPalettes = isCgb && options.applyPalette !== false;
        const bgPalette = options.applyPalette === false
            ? [0, 1, 2, 3] as const
            : this.decodePalette(this.memory.peekByte(0xFF47));
        const objPalette0 = options.applyPalette === false
            ? [0, 1, 2, 3] as const
            : this.decodePalette(this.memory.peekByte(0xFF48));
        const objPalette1 = options.applyPalette === false
            ? [0, 1, 2, 3] as const
            : this.decodePalette(this.memory.peekByte(0xFF49));
        const respectLcdEnable = options.respectLcdEnable ?? true;
        const bgEnabled = (lcdc & 0x01) !== 0;
        const windowEnabled = (lcdc & 0x20) !== 0;
        const spriteEnabled = (lcdc & 0x02) !== 0;

        if (respectLcdEnable && (lcdc & 0x80) === 0) {
            const blankColor = isDmgColorized
                ? this.memory.getDmgCompatibilityColor("bg", bgPalette[0])
                : DMG_SCREEN_COLORS[bgPalette[0]];

            for (let pixelIndex = 0; pixelIndex < LCD_WIDTH * LCD_HEIGHT; pixelIndex += 1) {
                this.writePixel(frame, pixelIndex, blankColor);
            }
            return frame;
        }

        const useUnsignedTiles = (lcdc & 0x10) !== 0;
        const scrollY = this.memory.peekByte(0xFF42);
        const scrollX = this.memory.peekByte(0xFF43);
        const windowY = this.memory.peekByte(0xFF4A);
        const windowX = this.memory.peekByte(0xFF4B) - 7;
        const spriteHeight = (lcdc & 0x04) !== 0 ? 16 : 8;
        const bgColorIndexes = new Uint8Array(LCD_WIDTH * LCD_HEIGHT);
        const bgPriorityMap = new Uint8Array(LCD_WIDTH * LCD_HEIGHT);

        for (let y = 0; y < LCD_HEIGHT; y += 1) {
            for (let x = 0; x < LCD_WIDTH; x += 1) {
                let colorIndex = 0;
                let rgba = isDmgColorized
                    ? this.memory.getDmgCompatibilityColor("bg", bgPalette[0])
                    : DMG_SCREEN_COLORS[bgPalette[0]];
                let priority = false;

                if (bgEnabled) {
                    const tilePixel = this.getTileMapPixel(
                        x + scrollX,
                        y + scrollY,
                        (lcdc & 0x08) !== 0 ? 0x9C00 : 0x9800,
                        useUnsignedTiles,
                        isCgb,
                        useColorPalettes,
                        isDmgColorized,
                        bgPalette,
                    );
                    colorIndex = tilePixel.colorIndex;
                    rgba = tilePixel.rgba;
                    priority = tilePixel.priority;
                }

                if (windowEnabled && y >= windowY && x >= windowX) {
                    const tilePixel = this.getTileMapPixel(
                        x - windowX,
                        y - windowY,
                        (lcdc & 0x40) !== 0 ? 0x9C00 : 0x9800,
                        useUnsignedTiles,
                        isCgb,
                        useColorPalettes,
                        isDmgColorized,
                        bgPalette,
                    );
                    colorIndex = tilePixel.colorIndex;
                    rgba = tilePixel.rgba;
                    priority = tilePixel.priority;
                }

                const index = (y * LCD_WIDTH) + x;
                bgColorIndexes[index] = colorIndex;
                bgPriorityMap[index] = priority ? 1 : 0;
                this.writePixel(frame, index, rgba);
            }
        }

        if (spriteEnabled) {
            for (let spriteIndex = 39; spriteIndex >= 0; spriteIndex -= 1) {
                const spriteAddress = 0xFE00 + (spriteIndex * 4);
                const screenY = this.memory.peekByte(spriteAddress) - 16;
                const screenX = this.memory.peekByte(spriteAddress + 1) - 8;
                let tileNumber = this.memory.peekByte(spriteAddress + 2);
                const attributes = this.memory.peekByte(spriteAddress + 3);
                const usePalette1 = (attributes & 0x10) !== 0;
                const cgbPalette = attributes & 0x07;
                const tileBank = isCgb && (attributes & 0x08) !== 0 ? 1 : 0;
                const xFlip = (attributes & 0x20) !== 0;
                const yFlip = (attributes & 0x40) !== 0;
                const bgPriority = (attributes & 0x80) !== 0;

                if (screenX <= -8 || screenX >= LCD_WIDTH || screenY <= -spriteHeight || screenY >= LCD_HEIGHT) {
                    continue;
                }

                if (spriteHeight === 16) {
                    tileNumber &= 0xFE;
                }

                for (let row = 0; row < spriteHeight; row += 1) {
                    const y = screenY + row;
                    if (y < 0 || y >= LCD_HEIGHT) {
                        continue;
                    }

                    const spriteRow = yFlip ? (spriteHeight - 1 - row) : row;
                    const tileOffset = spriteHeight === 16 && spriteRow >= 8 ? 1 : 0;
                    const tileAddress = 0x8000 + ((tileNumber + tileOffset) * TILE_BYTES);
                    const pixelRow = spriteHeight === 16 ? spriteRow & 0x07 : spriteRow;

                    for (let column = 0; column < 8; column += 1) {
                        const x = screenX + column;
                        if (x < 0 || x >= LCD_WIDTH) {
                            continue;
                        }

                        const pixelColumn = xFlip ? 7 - column : column;
                        const colorIndex = this.readTilePixel(tileAddress, pixelRow, pixelColumn, tileBank);
                        if (colorIndex === 0) {
                            continue;
                        }

                        const frameIndex = (y * LCD_WIDTH) + x;
                        const bgColorNonZero = bgColorIndexes[frameIndex] !== 0;
                        if (isCgb && bgPriorityMap[frameIndex] !== 0 && bgColorNonZero) {
                            continue;
                        }

                        if (bgPriority && bgColorNonZero) {
                            continue;
                        }

                        const rgba = useColorPalettes
                            ? this.memory.getCgbPaletteColor("obj", cgbPalette, colorIndex)
                            : (isDmgColorized
                                ? this.memory.getDmgCompatibilityColor(usePalette1 ? "obj1" : "obj0", colorIndex)
                                : DMG_SCREEN_COLORS[(usePalette1 ? objPalette1 : objPalette0)[colorIndex]]);
                        this.writePixel(frame, frameIndex, rgba);
                    }
                }
            }
        }

        return frame;
    }

    renderTileAtlas(options: RenderOptions = {}): Uint8Array {
        const atlas = new Uint8Array(TILESET_WIDTH * TILESET_HEIGHT * 4);
        const isCgb = this.memory.isCgbModeEnabled();
        const isDmgColorized = !isCgb && this.memory.isDmgCompatibilityColorModeEnabled() && options.applyPalette !== false;
        const palette = options.applyPalette === false
            ? [0, 1, 2, 3] as const
            : this.decodePalette(this.memory.peekByte(0xFF47));

        for (let tileIndex = 0; tileIndex < TILESET_TILE_COUNT; tileIndex += 1) {
            const tileX = (tileIndex % TILESET_COLUMNS) * TILE_SIZE;
            const tileY = Math.floor(tileIndex / TILESET_COLUMNS) * TILE_SIZE;
            const tileAddress = 0x8000 + (tileIndex * TILE_BYTES);

            for (let row = 0; row < TILE_SIZE; row += 1) {
                for (let column = 0; column < TILE_SIZE; column += 1) {
                    const colorIndex = this.readTilePixel(tileAddress, row, column, 0);
                    const atlasIndex = ((tileY + row) * TILESET_WIDTH) + tileX + column;
                    const rgba = options.applyPalette === false
                        ? DMG_SCREEN_COLORS[colorIndex]
                        : (isCgb
                            ? this.memory.getCgbPaletteColor("bg", 0, colorIndex)
                            : (isDmgColorized
                                ? this.memory.getDmgCompatibilityColor("bg", colorIndex)
                                : DMG_SCREEN_COLORS[palette[colorIndex]]));

                    this.writePixel(atlas, atlasIndex, rgba);
                }
            }
        }

        return atlas;
    }

    countNonZeroVramBytes(): number {
        let total = 0;

        for (let address = 0x8000; address < 0xA000; address += 1) {
            if (this.memory.peekByte(address) !== 0) {
                total += 1;
            }
        }

        return total;
    }

    countUniqueShades(frame: Uint8Array): number {
        const seen = new Set<string>();

        for (let index = 0; index < frame.length; index += 4) {
            seen.add(`${frame[index]}-${frame[index + 1]}-${frame[index + 2]}-${frame[index + 3]}`);
            if (seen.size === 4) {
                break;
            }
        }

        return seen.size;
    }

    private getTileMapPixel(
        mapX: number,
        mapY: number,
        tileMapBase: number,
        useUnsignedTiles: boolean,
        isCgb: boolean,
        useColorPalettes: boolean,
        isDmgColorized: boolean,
        dmgPalette: readonly [number, number, number, number],
    ): TilePixelResult {
        const wrappedX = mapX & 0xFF;
        const wrappedY = mapY & 0xFF;
        const tileRow = (wrappedY >> 3) & 0x1F;
        const tileColumn = (wrappedX >> 3) & 0x1F;
        const mapAddress = tileMapBase + (tileRow * 32) + tileColumn;
        const attributes = isCgb ? this.memory.peekVideoRamByte(mapAddress, 1) : 0;
        const xFlip = isCgb && (attributes & 0x20) !== 0;
        const yFlip = isCgb && (attributes & 0x40) !== 0;
        const pixelRow = yFlip ? 7 - (wrappedY & 0x07) : (wrappedY & 0x07);
        const pixelColumn = xFlip ? 7 - (wrappedX & 0x07) : (wrappedX & 0x07);
        const tileNumber = this.memory.peekVideoRamByte(mapAddress, 0);
        const tileAddress = this.resolveTileAddress(tileNumber, useUnsignedTiles);
        const tileBank = isCgb && (attributes & 0x08) !== 0 ? 1 : 0;
        const colorIndex = this.readTilePixel(tileAddress, pixelRow, pixelColumn, tileBank);
        const rgba = useColorPalettes
            ? this.memory.getCgbPaletteColor("bg", attributes & 0x07, colorIndex)
            : (isDmgColorized
                ? this.memory.getDmgCompatibilityColor("bg", colorIndex)
                : DMG_SCREEN_COLORS[dmgPalette[colorIndex]]);

        return {
            colorIndex,
            rgba,
            priority: isCgb && (attributes & 0x80) !== 0,
        };
    }

    private resolveTileAddress(tileNumber: number, useUnsignedTiles: boolean): number {
        if (useUnsignedTiles) {
            return 0x8000 + (tileNumber * TILE_BYTES);
        }

        const signedTileNumber = tileNumber < 0x80 ? tileNumber : tileNumber - 0x100;
        return 0x9000 + (signedTileNumber * TILE_BYTES);
    }

    private readTilePixel(tileAddress: number, row: number, column: number, bank: 0 | 1): number {
        const rowAddress = tileAddress + (row * 2);
        const lowByte = this.memory.peekVideoRamByte(rowAddress, bank);
        const highByte = this.memory.peekVideoRamByte(rowAddress + 1, bank);
        const shift = 7 - column;
        const lowBit = (lowByte >> shift) & 0x01;
        const highBit = (highByte >> shift) & 0x01;

        return (highBit << 1) | lowBit;
    }

    private writePixel(frame: Uint8Array, pixelIndex: number, rgba: readonly [number, number, number, number]) {
        const offset = pixelIndex * 4;
        frame[offset] = rgba[0];
        frame[offset + 1] = rgba[1];
        frame[offset + 2] = rgba[2];
        frame[offset + 3] = rgba[3];
    }

    private decodePalette(value: number): [number, number, number, number] {
        return [
            value & 0x03,
            (value >> 2) & 0x03,
            (value >> 4) & 0x03,
            (value >> 6) & 0x03,
        ];
    }
}
