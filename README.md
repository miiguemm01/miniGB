# miniGB

Emulador homemade de Nintendo Game Boy escrito en TypeScript.

Ahora mismo el proyecto esta orientado a depuracion y desarrollo iterativo: ejecuta ROMs, expone un panel web para ver la LCD, tiles de VRAM, registros y traza reciente, y permite guardar snapshots cuando falta un opcode para seguir trabajando desde ese punto.

## Estado actual

- CPU parcialmente implementada
- Memoria de 64 KB con soporte basico de cartucho y MBC5
- Salto del boot ROM con estado post-BIOS de DMG
- Render de background, ventana y sprites
- Panel web de depuracion en tiempo real
- Input basico de Game Boy desde navegador
- Snapshots automaticos al encontrar opcodes no implementados

No es un emulador completo ni exacto todavia. Hay muchas partes del hardware que siguen simplificadas.

## Estructura

- [src/index.ts](/c:/Users/mmordev/Desktop/Proyectos/minigb/src/index.ts)  
  Punto de entrada, bucle principal, servidor HTTP, panel web, input y snapshots.

- [src/hardware/cpu.ts](/c:/Users/mmordev/Desktop/Proyectos/minigb/src/hardware/cpu.ts)  
  Implementacion de opcodes, flags, interrupciones y estado de CPU.

- [src/hardware/memory.ts](/c:/Users/mmordev/Desktop/Proyectos/minigb/src/hardware/memory.ts)  
  Mapa de memoria, MBC, JOYP, DMA, contadores basicos y estado post-boot.

- [src/hardware/video.ts](/c:/Users/mmordev/Desktop/Proyectos/minigb/src/hardware/video.ts)  
  Renderer de LCD y tileset de VRAM para el panel de depuracion.

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

Por defecto arranca con `./roms/pkmnred.gb`:

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

Cambia `PORT` si quieres, puedes pasarlo como argumento:

```powershell
$env:PORT=3040; npm start
```

## Panel de depuracion

El panel web muestra:

- LCD renderizada
- Tileset completo de VRAM
- Registros de CPU
- `PC`, `SP`, `LCDC`, `LY`, `JOYP`
- Numero de instrucciones, ciclos y frames
- Modo de pantalla (`lcd` o `debug`)
- Notas de video
- Ultimo error y traza reciente

## Controles

En el panel:

- `DPAD` = cruceta
- `Z` = `A`
- `X` = `B`
- `Enter` = `Start`
- `Shift` = `Select`

Tambien hay botones on-screen para probar input con raton o tactil.

## Snapshots

Cuando el emulador encuentra un opcode no implementado, guarda automaticamente un snapshot completo del estado.

Ruta actual:

```text
./state/unknown-opcode-snapshot.json
```

El comportamiento se controla en [src/index.ts](/c:/Users/mmordev/Desktop/Proyectos/minigb/src/index.ts):

- `LOAD_FROM_SNAPSHOT = false`  
  Arranca desde el principio.

- `LOAD_FROM_SNAPSHOT = true`  
  Intenta restaurar el snapshot guardado si corresponde a la ROM actual.

Esto sirve para:

1. Ejecutar hasta que falte un opcode
2. Guardar el estado exacto
3. Implementar el opcode
4. Reanudar desde ese punto sin volver a recorrer toda la ROM

## ROMs incluidas en el repo - EDIT: Se han suprimido.

Ninguna.

## Limitaciones conocidas

- La CPU no tiene todos los opcodes implementados
- El timing sigue siendo aproximado en varias areas
- El PPU no es ciclo-exacto
- Las interrupciones y perifericos todavia estan simplificados
- Falta bastante trabajo de compatibilidad general entre ROMs


## Objetivo del proyecto

El objetivo actual no es competir con emuladores maduros, sino construir y depurar un emulador de Game Boy paso a paso, entendiendo cada subsistema y dejando herramientas para iterar rapido.
