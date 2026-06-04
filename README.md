# miniGB

Emulador homemade de Nintendo Game Boy y Game Boy Color escrito en TypeScript.

El proyecto esta orientado a depuracion e iteracion rapida: ejecuta ROMs, expone un panel web en tiempo real, permite guardar y cargar estado por ROM, y guarda snapshots automaticos cuando aparece un opcode no implementado.

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
- Panel web de depuracion en tiempo real con streaming
- Input desde navegador
- Audio experimental desde Web Audio
- Savestates por ROM
- Snapshots automaticos al encontrar opcodes no implementados

No es un emulador completo ni exacto todavia. Varias partes del hardware siguen simplificadas.

## Estructura

- [src/index.ts](/c:/Users/mmordev/Desktop/Proyectos/minigb/src/index.ts)
  Punto de entrada, bucle principal, servidor HTTP, panel web, input, stream, savestates y snapshots.

- [src/hardware/cpu.ts](/c:/Users/mmordev/Desktop/Proyectos/minigb/src/hardware/cpu.ts)
  Implementacion de opcodes, flags, interrupciones y estado de CPU.

- [src/hardware/memory.ts](/c:/Users/mmordev/Desktop/Proyectos/minigb/src/hardware/memory.ts)
  Mapa de memoria, mappers, JOYP, DMA, HDMA, estado CGB, audio y contadores principales.

- [src/hardware/video.ts](/c:/Users/mmordev/Desktop/Proyectos/minigb/src/hardware/video.ts)
  Renderer de LCD y tileset de VRAM, tanto en escala DMG como en color CGB.

- [src/hardware/romloader.ts](/c:/Users/mmordev/Desktop/Proyectos/minigb/src/hardware/romloader.ts)
  Carga de ROMs desde disco.

## Requisitos

- Node.js
- npm

## Instalacion

```bash
npm install
```

## Uso

Por defecto arranca con `./roms/pkmnyll.gb`:

```bash
npm start
```

Tambien puedes pasar otra ROM como argumento:

```bash
npm start -- ./roms/tetris.gb
```

Despues abre:

```text
http://localhost:3030
```

Si quieres otro puerto:

```powershell
$env:PORT=3040; npm start
```

## Panel de depuracion

El panel muestra:

- LCD renderizada
- Tileset completo de VRAM
- Registros de CPU
- `PC`, `SP`, `LCDC`, `LY`, `JOYP`
- mapper, tipo de cartucho, bancos ROM/RAM y features detectadas
- numero de instrucciones, ciclos y frames
- modo de pantalla (`lcd` o `debug`)
- notas de video
- estado del audio
- ultimo error y traza reciente
- informacion del savestate actual

La UI ya no usa polling continuo para cada recurso. El panel recibe el estado y los frames mediante un stream persistente desde el servidor embebido.

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

## Savestates

Cada ROM tiene su propio savestate:

```text
./state/<rom>-savestate.json
```

Desde el panel puedes:

- guardar con `K` o `Save`
- cargar con `L` o `Load`

El savestate incluye CPU, memoria, bancos de ROM/RAM, estado CGB, audio, counters del emulador y traza reciente.

## Snapshots de opcode faltante

Cuando el emulador encuentra un opcode no implementado, guarda automaticamente un snapshot completo para reanudar desde ese punto.

Ruta:

```text
./state/<rom>-unknown-opcode-snapshot.json
```

El comportamiento se controla en [src/index.ts](/c:/Users/mmordev/Desktop/Proyectos/minigb/src/index.ts):

- `LOAD_FROM_SNAPSHOT = false`
  Arranca desde el principio.

- `LOAD_FROM_SNAPSHOT = true`
  Intenta restaurar el snapshot asociado a la ROM actual.

## Sonido

Hay una primera implementacion experimental de audio conectada a Web Audio:

- lectura de registros principales del APU
- sintesis aproximada de los cuatro canales
- controles `Enable audio` y `Mute` en el panel

No es un APU exacto, pero sirve para depurar si la ROM esta programando audio y para oir una aproximacion util del resultado.

## Soporte de cartuchos y hardware

Cartuchos soportados actualmente:

- `ROM only`
- `MBC1`
- `MBC3`
- `MBC5`

Hardware soportado parcialmente:

- modo `DMG`
- modo `CGB`
- compatibilidad de juegos DMG sobre hardware CGB con paletas de color

## Limitaciones conocidas

- La CPU todavia no tiene todos los opcodes implementados
- El timing sigue siendo aproximado en varias areas
- El PPU no es ciclo-exacto
- `HDMA`, `STAT`, interrupciones y doble velocidad no estan afinados al 100%
- El audio es funcional pero todavia aproximado
- La compatibilidad entre ROMs sigue en construccion

## Objetivo del proyecto

El objetivo actual no es competir con emuladores maduros, sino construir y depurar un emulador de Game Boy paso a paso, entendiendo cada subsistema y dejando herramientas para iterar rapido.
