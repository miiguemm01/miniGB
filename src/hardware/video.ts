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

export class VideoRenderer {
    constructor(private readonly memory: Memory) {}

    renderScreen(options: RenderOptions = {}): Uint8Array {
        const frame = new Uint8Array(LCD_WIDTH * LCD_HEIGHT);
        const lcdc = this.memory.peekByte(0xFF40);
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
            frame.fill(bgPalette[0]);
            return frame;
        }

        const useUnsignedTiles = (lcdc & 0x10) !== 0;
        const scrollY = this.memory.peekByte(0xFF42);
        const scrollX = this.memory.peekByte(0xFF43);
        const windowY = this.memory.peekByte(0xFF4A);
        const windowX = this.memory.peekByte(0xFF4B) - 7;
        const spriteHeight = (lcdc & 0x04) !== 0 ? 16 : 8;
        const bgColorIndexes = new Uint8Array(LCD_WIDTH * LCD_HEIGHT);

        for (let y = 0; y < LCD_HEIGHT; y += 1) {
            for (let x = 0; x < LCD_WIDTH; x += 1) {
                let colorIndex = 0;

                if (bgEnabled) {
                    colorIndex = this.getTileMapPixel(
                        x + scrollX,
                        y + scrollY,
                        (lcdc & 0x08) !== 0 ? 0x9C00 : 0x9800,
                        useUnsignedTiles,
                    );
                }

                if (windowEnabled && y >= windowY && x >= windowX) {
                    colorIndex = this.getTileMapPixel(
                        x - windowX,
                        y - windowY,
                        (lcdc & 0x40) !== 0 ? 0x9C00 : 0x9800,
                        useUnsignedTiles,
                    );
                }

                const index = (y * LCD_WIDTH) + x;
                bgColorIndexes[index] = colorIndex;
                frame[index] = bgPalette[colorIndex];
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
                        const colorIndex = this.readTilePixel(tileAddress, pixelRow, pixelColumn);
                        if (colorIndex === 0) {
                            continue;
                        }

                        const frameIndex = (y * LCD_WIDTH) + x;
                        if (bgPriority && bgColorIndexes[frameIndex] !== 0) {
                            continue;
                        }

                        const palette = usePalette1 ? objPalette1 : objPalette0;
                        frame[frameIndex] = palette[colorIndex];
                    }
                }
            }
        }

        return frame;
    }

    renderTileAtlas(options: RenderOptions = {}): Uint8Array {
        const atlas = new Uint8Array(TILESET_WIDTH * TILESET_HEIGHT);
        const palette = options.applyPalette === false
            ? [0, 1, 2, 3] as const
            : this.decodePalette(this.memory.peekByte(0xFF47));

        for (let tileIndex = 0; tileIndex < TILESET_TILE_COUNT; tileIndex += 1) {
            const tileX = (tileIndex % TILESET_COLUMNS) * TILE_SIZE;
            const tileY = Math.floor(tileIndex / TILESET_COLUMNS) * TILE_SIZE;
            const tileAddress = 0x8000 + (tileIndex * TILE_BYTES);

            for (let row = 0; row < TILE_SIZE; row += 1) {
                for (let column = 0; column < TILE_SIZE; column += 1) {
                    const colorIndex = this.readTilePixel(tileAddress, row, column);
                    const atlasIndex = ((tileY + row) * TILESET_WIDTH) + tileX + column;

                    atlas[atlasIndex] = palette[colorIndex];
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
        const seen = new Set<number>();

        for (const shade of frame) {
            seen.add(shade);
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
    ): number {
        const wrappedX = mapX & 0xFF;
        const wrappedY = mapY & 0xFF;
        const tileRow = (wrappedY >> 3) & 0x1F;
        const tileColumn = (wrappedX >> 3) & 0x1F;
        const pixelRow = wrappedY & 0x07;
        const pixelColumn = wrappedX & 0x07;
        const tileNumber = this.memory.peekByte(tileMapBase + (tileRow * 32) + tileColumn);
        const tileAddress = this.resolveTileAddress(tileNumber, useUnsignedTiles);

        return this.readTilePixel(tileAddress, pixelRow, pixelColumn);
    }

    private resolveTileAddress(tileNumber: number, useUnsignedTiles: boolean): number {
        if (useUnsignedTiles) {
            return 0x8000 + (tileNumber * TILE_BYTES);
        }

        const signedTileNumber = tileNumber < 0x80 ? tileNumber : tileNumber - 0x100;
        return 0x9000 + (signedTileNumber * TILE_BYTES);
    }

    private readTilePixel(tileAddress: number, row: number, column: number): number {
        const rowAddress = tileAddress + (row * 2);
        const lowByte = this.memory.peekByte(rowAddress);
        const highByte = this.memory.peekByte(rowAddress + 1);
        const shift = 7 - column;
        const lowBit = (lowByte >> shift) & 0x01;
        const highBit = (highByte >> shift) & 0x01;

        return (highBit << 1) | lowBit;
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
