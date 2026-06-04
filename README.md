# miniGB

Emulador homemade de Nintendo Game Boy y Game Boy Color escrito en TypeScript.

El proyecto sigue orientado a depuracion e iteracion rapida, pero ahora el panel corre como app de escritorio con Electron en vez de depender de un servidor web embebido.

## Estado actual

- CPU parcialmente implementada, con una parte importante del set base y CB-prefixed
- Soporte de cartuchos `ROM only`, `MBC1`, `MBC3` y `MBC5`
- Arranque sin boot ROM con estado post-boot de `DMG` o `CGB`
- Render de background, ventana y sprites
- Modo Game Boy Color con:
  - paletas CGB
  - banco extra de VRAM
  - banking de WRAM (`SVBK`)
  - `KEY1` y cambio de velocidad
  - base de `HDMA/GDMA`
- Colorizacion de compatibilidad para juegos DMG ejecutados sobre hardware CGB
- App Electron de depuracion en tiempo real
- Input integrado en la ventana
- Controles de velocidad `1x`, `2x`, `4x` y `8x` en tiempo real
- Audio experimental desde Web Audio
- Savestates por ROM
- Snapshots automaticos al encontrar opcodes no implementados

No es un emulador completo ni exacto todavia. Varias partes del hardware siguen simplificadas.

## Estructura

- [src/electron/main.ts](/c:/Users/mmordev/Desktop/Proyectos/minigb/src/electron/main.ts)
  Punto de entrada de Electron, ventana principal e IPC.

- [src/emulator/session.ts](/c:/Users/mmordev/Desktop/Proyectos/minigb/src/emulator/session.ts)
  Sesion reutilizable del emulador: bucle principal, input, frames, savestates y snapshots.

- [src/ui/index.html](/c:/Users/mmordev/Desktop/Proyectos/minigb/src/ui/index.html)
  Interfaz local cargada por Electron.

- [src/electron/preload.js](/c:/Users/mmordev/Desktop/Proyectos/minigb/src/electron/preload.js)
  Bridge seguro entre renderer e IPC para input, frames, savestates y velocidad.

- [src/emulator/types.ts](/c:/Users/mmordev/Desktop/Proyectos/minigb/src/emulator/types.ts)
  Tipos compartidos del estado, payloads de frame y API expuesta al renderer.

- [src/hardware/cpu.ts](/c:/Users/mmordev/Desktop/Proyectos/minigb/src/hardware/cpu.ts)
  Implementacion de opcodes, flags, interrupciones y estado de CPU.

- [src/hardware/memory.ts](/c:/Users/mmordev/Desktop/Proyectos/minigb/src/hardware/memory.ts)
  Mapa de memoria, mappers, JOYP, DMA, HDMA, estado CGB, audio y contadores principales.

- [src/hardware/video.ts](/c:/Users/mmordev/Desktop/Proyectos/minigb/src/hardware/video.ts)
  Renderer de LCD y tileset de VRAM, tanto en escala DMG como en color CGB.

## Requisitos

- Node.js
- npm

## Instalacion

```bash
npm install
```

## Uso

Por defecto arranca con `./roms/pkmncrstl.gbc`:

```bash
npm start
```

Tambien puedes pasar otra ROM como argumento:

```bash
npm start -- ./roms/tetris.gb
```

Se abrira directamente la ventana de Electron con el panel de depuracion.

## Panel de depuracion

La app muestra:

- LCD renderizada
- Tileset completo de VRAM
- Registros de CPU
- `PC`, `SP`, `LCDC`, `LY`, `JOYP`
- mapper, tipo de cartucho, bancos ROM/RAM y features detectadas
- numero de instrucciones, ciclos y frames
- selector de velocidad `1x`, `2x`, `4x`, `8x`
- modo de pantalla (`lcd` o `debug`)
- notas de video
- estado del audio
- ultimo error y traza reciente
- informacion del savestate actual

El renderer recibe estado y frames por IPC desde el proceso principal, sin `HTTP`, `SSE` ni polling del navegador.

## Controles

- `W` = `Up`
- `A` = `Left`
- `S` = `Down`
- `D` = `Right`
- `Z` = `A`
- `X` = `B`
- `Enter` = `Start`
- `Shift` = `Select`
- `K` = guardar savestate
- `L` = cargar savestate

Tambien hay botones on-screen para input, save/load y control de audio.

La velocidad de emulacion se puede cambiar desde la UI con botones `1x`, `2x`, `4x` y `8x`.

## Savestates

Cada ROM tiene su propio savestate:

```text
./state/<rom>-savestate.json
```

Desde la app puedes:

- guardar con `K` o `Save State`
- cargar con `L` o `Load State`

## Snapshots de opcode faltante

Cuando el emulador encuentra un opcode no implementado, guarda automaticamente un snapshot completo para reanudar desde ese punto.

Ruta:

```text
./state/<rom>-unknown-opcode-snapshot.json
```

## Sonido

Hay una primera implementacion experimental de audio conectada a Web Audio:

- lectura de registros principales del APU
- sintesis aproximada de los cuatro canales
- inicializacion automatica al abrir la ventana
- control `Mute`

No es un APU exacto, pero sirve para depurar si la ROM esta programando audio y para oir una aproximacion util del resultado.
