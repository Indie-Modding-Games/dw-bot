# DevBot --- Documento de inicio del proyecto

**Tipo:** Especificación inicial / MVP\
**Estado:** Propuesta para implementación\
**Prioridad de plataforma:** **Discord primero**\
**IA:** No incluida en el MVP\
**Lenguaje recomendado:** TypeScript\
**Runtime:** Node.js

---

## 1. Visión

DevBot es una herramienta personal y extensible de automatización para
desarrollo de software. Su primera interfaz será un bot de Discord desde
el que se podrán consultar proyectos, ejecutar tareas previamente
registradas, programar automatizaciones y recibir notificaciones.

El bot de Discord será únicamente una interfaz. La lógica de negocio y
el motor de ejecución deben permanecer independientes de Discord para
permitir incorporar otras interfaces en el futuro (por ejemplo,
Telegram, CLI, REST o MCP) sin reescribir el núcleo.

**Principio central:** DevBot ejecuta tareas explícitamente registradas
y autorizadas; no es una terminal remota de comandos arbitrarios.

## 2. Objetivos del MVP

El MVP debe permitir:

1.  Interactuar con DevBot desde Discord mediante slash commands.
2.  Autorizar usuarios y, opcionalmente, servidores/canales.
3.  Registrar y consultar proyectos locales.
4.  Definir tareas permitidas para cada proyecto.
5.  Ejecutar tareas bajo demanda.
6.  Ejecutar tareas automáticamente mediante un scheduler.
7.  Consultar el estado y el historial de ejecuciones.
8.  Enviar notificaciones cuando una tarea termine o falle.
9.  Mantener el motor desacoplado de Discord.
10. Persistir proyectos, tareas, ejecuciones y programaciones.

## 3. Fuera del alcance del MVP

No implementar inicialmente:

- Inteligencia artificial, LLMs o agentes autónomos.
- Ejecución libre de comandos enviados por usuarios.
- Editor de código o administración remota completa del equipo.
- Panel web.
- Soporte para Telegram.
- MCP Server o API pública.
- Arquitectura de microservicios.
- Kubernetes, Redis o infraestructura distribuida.
- Ejecución de código de terceros sin aislamiento.

Estas capacidades podrán evaluarse después de estabilizar el MVP.

## 4. Casos de uso principales

### 4.1 Ejecución bajo demanda

Un usuario autorizado solicita ejecutar una tarea registrada:

1.  Selecciona un proyecto.
2.  Selecciona una tarea disponible para ese proyecto.
3.  DevBot valida permisos y configuración.
4.  El motor crea una ejecución.
5.  El worker ejecuta el proceso con directorio, argumentos y timeout
    definidos.
6.  Se almacena el resultado.
7.  Discord recibe un resumen y, si corresponde, una salida limitada.

Ejemplo conceptual:

```text
/projects
/tasks digimon
/run digimon test
/status
/history digimon
```

Los comandos definitivos serán slash commands de Discord, por ejemplo
`/projects`, `/tasks`, `/run`, `/status` y `/history`.

### 4.2 Ejecución automática

1.  Un administrador crea una programación para una tarea existente.
2.  El scheduler detecta cuándo corresponde ejecutarla.
3.  Se crea una ejecución con el mismo flujo usado por las ejecuciones
    manuales.
4.  Al finalizar, se emite un evento.
5.  El adaptador de Discord envía una notificación al canal configurado.

Las ejecuciones manuales y programadas deben utilizar el mismo motor y
las mismas validaciones.

### 4.3 Monitorización

El sistema podrá ejecutar comprobaciones periódicas, por ejemplo:

- Verificar que un servicio HTTP responde.
- Comprobar el estado de un repositorio Git.
- Revisar el resultado de una compilación.
- Ejecutar tests o linters.
- Comprobar si hay cambios en una rama.

## 5. Arquitectura propuesta

Se recomienda un **monolito modular** con separación entre interfaz,
aplicación, dominio e infraestructura. No se necesitan microservicios
para el MVP.

```text
Discord
   |
   v
Discord Adapter (discord.js)
   |
   v
Application Layer
   |-- Command handlers
   |-- Authorization
   |-- Project service
   |-- Task service
   |-- Scheduling service
   |
   v
Core / Domain
   |-- Task registry
   |-- Execution manager
   |-- Queue
   |-- Event bus
   |-- Scheduler contracts
   |
   v
Infrastructure
   |-- Process runner
   |-- Git adapter
   |-- Filesystem adapter
   |-- SQLite repository
   |-- Scheduler implementation
   |
   v
Local environment / repositories
```

### Reglas de diseño

- El núcleo no debe importar `discord.js`.
- Los handlers de Discord traducen interacciones a casos de uso.
- Las tareas se definen en el registro o en la base de datos; nunca se
  construyen comandos directamente desde texto del usuario.
- Las ejecuciones manuales y automáticas pasan por el mismo servicio.
- Las integraciones externas se encapsulan detrás de adaptadores.
- La persistencia se accede mediante repositorios.
- Los eventos internos permiten notificar resultados sin acoplar el
  motor a Discord.

## 6. Stack tecnológico

Área Tecnología propuesta Uso

---

Runtime Node.js LTS Ejecución
Lenguaje TypeScript Código y contratos
Discord discord.js Gateway y slash commands
Validación Zod Validar configuración y entradas
Base de datos SQLite Persistencia local del MVP
ORM/migraciones Drizzle ORM Esquema y migraciones
Scheduler node-cron o scheduler propio Programaciones
Git simple-git o Git CLI controlado Operaciones Git
Logging Pino Logs estructurados
Tests Vitest Pruebas unitarias e integración

No se debe añadir una dependencia si una solución pequeña y mantenible
cubre la necesidad.

## 7. Estructura inicial del repositorio

```text
devbot/
├── src/
│   ├── application/
│   │   ├── commands/
│   │   ├── handlers/
│   │   └── services/
│   ├── core/
│   │   ├── events/
│   │   ├── tasks/
│   │   ├── execution/
│   │   ├── queue/
│   │   └── scheduler/
│   ├── domain/
│   │   ├── projects/
│   │   ├── tasks/
│   │   └── executions/
│   ├── infrastructure/
│   │   ├── discord/
│   │   ├── database/
│   │   ├── process/
│   │   ├── git/
│   │   └── filesystem/
│   ├── modules/
│   │   ├── projects/
│   │   ├── builds/
│   │   ├── testing/
│   │   └── monitoring/
│   ├── config/
│   └── index.ts
├── drizzle/
├── data/
├── tests/
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
└── README.md
```

La estructura puede ajustarse durante la implementación. Evitar crear
carpetas vacías sin una responsabilidad real.

## 8. Modelo de dominio y persistencia

### Project

Representa un repositorio o proyecto local.

- `id`
- `name` (único)
- `path`
- `repository_url` (opcional)
- `created_at`
- `updated_at`

### Task

Representa una operación permitida.

- `id`
- `project_id`
- `name`
- `description`
- `executable`
- `args` (JSON validado)
- `working_directory` (opcional; restringido al proyecto)
- `timeout_ms`
- `enabled`
- `created_at`

### Execution

Representa una ejecución concreta.

- `id`
- `task_id`
- `trigger_type` (`manual` o `scheduled`)
- `status`
- `requested_by` (opcional para tareas programadas)
- `started_at`
- `finished_at`
- `exit_code`
- `stdout`
- `stderr`
- `error_message`

Estados:

```ts
type ExecutionStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled' | 'timeout';
```

### Schedule

Representa una programación recurrente.

- `id`
- `task_id`
- `cron_expression`
- `timezone`
- `enabled`
- `notification_channel_id`
- `created_at`
- `updated_at`

### Configuración de Discord

La configuración de autorización y notificaciones debe poder establecer:

- IDs de usuarios autorizados.
- IDs de servidores permitidos.
- IDs de canales permitidos, cuando aplique.
- Canal de notificaciones.
- Rol administrador, si se decide utilizar roles.

Los IDs son identificadores de Discord, no nombres visibles.

## 9. Comandos de Discord del MVP

Usar **slash commands** nativos. No depender de comandos por prefijo.

---

Comando Descripción Permiso

---

`/help` Mostrar ayuda Usuario autorizado

`/status` Estado del bot y worker Usuario autorizado

`/projects` Listar proyectos Usuario autorizado

`/project-add` Registrar proyecto Administrador

`/tasks` Listar tareas de un Usuario autorizado
proyecto

`/run` Ejecutar una tarea Según política
registrada

`/history` Consultar ejecuciones Usuario autorizado
recientes

`/schedule-add` Programar una tarea Administrador

`/schedule-list` Listar programaciones Usuario autorizado

`/schedule-remove` Desactivar una Administrador
programación

`/cancel` Solicitar cancelación Administrador o
de una ejecución propietario
-----------------------------------------------------------------------

Los nombres y opciones definitivos se ajustarán a las restricciones de
nombres y tipos de opciones de Discord.

### Ejemplo de interacción

```text
/run project:digimon task:test

DevBot:
Ejecución iniciada.
Proyecto: digimon
Tarea: test
ID: exec_...

[Al terminar]

DevBot:
Resultado: SUCCESS
Duración: 4.2 s
Código de salida: 0
```

Las interacciones de Discord tienen límites de tiempo de respuesta. El
handler debe reconocer/deferir la interacción rápidamente y enviar el
resultado posteriormente mediante follow-up o edición de la respuesta.

## 10. Motor de ejecución

El motor recibe una tarea ya validada, crea una ejecución y la procesa.

Contrato conceptual:

```ts
export interface TaskDefinition {
  id: string;
  projectId: string;
  name: string;
  executable: string;
  args: string[];
  timeoutMs: number;
}

export interface TaskRunner {
  execute(task: TaskDefinition): Promise<TaskResult>;
}

export interface TaskResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}
```

### Requisitos del runner

- Ejecutar procesos con `shell: false`.
- No aceptar ejecutables ni argumentos arbitrarios desde Discord.
- Resolver y validar el directorio de trabajo.
- Restringir el directorio de trabajo al proyecto registrado.
- Aplicar timeout.
- Limitar la cantidad de salida almacenada y enviada.
- Capturar errores de inicio y finalización.
- Registrar código de salida y duración.
- Gestionar cancelaciones.
- Evitar ejecuciones duplicadas accidentales.
- Controlar concurrencia.

**Política inicial recomendada:** una ejecución a la vez. La cola debe
permitir ampliar la concurrencia más adelante.

En Windows y WSL, el ejecutable y el directorio de trabajo deben
pertenecer al mismo entorno. Por ejemplo, si se ejecuta `make` dentro de
WSL, la configuración debe utilizar rutas y herramientas de WSL de forma
explícita. No asumir que una ruta `D:\...` es directamente válida dentro
de Linux.

## 11. Seguridad

La seguridad es un requisito funcional, no una mejora futura.

1.  **Allowlist:** solo usuarios y servidores autorizados pueden
    interactuar con el bot.
2.  **Permisos por operación:** registrar proyectos y programaciones
    requiere permisos administrativos.
3.  **Sin shell arbitrario:** no implementar `/shell`, `eval` ni
    ejecución de texto libre.
4.  **Tareas declarativas:** cada tarea tiene ejecutable y argumentos
    definidos por configuración confiable.
5.  **Rutas restringidas:** impedir que una ruta de proyecto escape del
    directorio raíz permitido.
6.  **Secretos:** tokens y credenciales en variables de entorno; nunca
    en Git.
7.  **Salida segura:** truncar logs y evitar publicar secretos o
    variables de entorno.
8.  **Auditoría:** registrar quién solicitó cada ejecución y su
    resultado.
9.  **Timeout y límites:** evitar procesos infinitos o salidas
    ilimitadas.
10. **Confirmación:** operaciones destructivas deben exigir confirmación
    explícita.
11. **Permisos mínimos:** el proceso del bot no debe ejecutarse como
    administrador/root.
12. **Aislamiento:** no ejecutar código de repositorios desconocidos sin
    un entorno aislado.

La lista de tareas permitidas debe ser administrada por el propietario
del bot. Un usuario de Discord no puede convertir una tarea registrada
en una ejecución arbitraria modificando sus parámetros.

## 12. Automatización y eventos

El scheduler no ejecuta comandos por su cuenta. Cuando llega la hora,
solicita al servicio de aplicación que cree una ejecución normal.

Flujo:

```text
Cron trigger
    |
    v
Schedule service
    |
    v
Task service
    |
    v
Execution queue
    |
    v
Task runner
    |
    v
Execution result
    |
    v
Execution event
    |
    v
Discord notification
```

Eventos internos iniciales:

- `task.execution.requested`
- `task.execution.started`
- `task.execution.succeeded`
- `task.execution.failed`
- `task.execution.cancelled`
- `schedule.triggered`

Para el MVP, un Event Bus en memoria es suficiente. La persistencia de
ejecuciones debe realizarse en SQLite.

## 13. Estrategia de pruebas

### Unitarias

- Validación de tareas.
- Autorización.
- Resolución de proyectos.
- Reglas de rutas.
- Transiciones de estado.
- Scheduler y cálculo de próximas ejecuciones.

### Integración

- Ejecución de un script de prueba controlado.
- Captura de stdout y stderr.
- Timeout.
- Código de salida no exitoso.
- Cancelación.
- Persistencia de ejecuciones.
- Recuperación de ejecuciones interrumpidas al reiniciar.

### Discord

- Usuario autorizado.
- Usuario no autorizado.
- Slash command válido.
- Slash command inválido.
- Respuesta diferida y resultado posterior.
- Error al enviar una notificación.

No ejecutar pruebas destructivas sobre repositorios reales.

## 14. Plan de implementación

### Iteración 1 --- Esqueleto y Discord

- [ ] Crear aplicación TypeScript.
- [ ] Configurar variables de entorno.
- [ ] Crear aplicación en Discord Developer Portal.
- [ ] Registrar bot e invitarlo al servidor de pruebas.
- [ ] Configurar intents y permisos mínimos.
- [ ] Registrar slash commands.
- [ ] Implementar `/help` y `/status`.
- [ ] Implementar allowlist.
- [ ] Añadir logging.

**Criterio de aceptación:** el bot aparece conectado en Discord y solo
responde a usuarios autorizados.

### Iteración 2 --- Proyectos y tareas

- [ ] Crear esquema SQLite y migraciones.
- [ ] Implementar repositorio de proyectos.
- [ ] Registrar proyectos.
- [ ] Registrar tareas permitidas.
- [ ] Implementar `/projects` y `/tasks`.
- [ ] Validar rutas y configuración.

**Criterio de aceptación:** los proyectos y tareas sobreviven al
reinicio del bot.

### Iteración 3 --- Ejecución

- [ ] Implementar TaskRunner.
- [ ] Implementar cola secuencial.
- [ ] Implementar timeout y cancelación.
- [ ] Persistir ejecuciones.
- [ ] Implementar `/run`.
- [ ] Implementar `/history`.
- [ ] Limitar y presentar la salida.

**Criterio de aceptación:** una tarea de prueba puede ejecutarse desde
Discord y su resultado queda almacenado.

### Iteración 4 --- Automatización

- [ ] Implementar scheduler.
- [ ] Crear y administrar programaciones.
- [ ] Reutilizar el motor de ejecución.
- [ ] Configurar canal de notificaciones.
- [ ] Manejar errores y reinicios.
- [ ] Añadir pruebas de integración.

**Criterio de aceptación:** una tarea registrada puede ejecutarse según
una programación y notificar su resultado.

### Iteración 5 --- Primeras integraciones de desarrollo

- [ ] Módulo Git status.
- [ ] Módulo de tests.
- [ ] Módulo de build.
- [ ] Integración GitHub para consultar repositorios y workflows.
- [ ] Monitorización HTTP.

Estas integraciones se priorizarán según el uso real del MVP.

## 15. Despliegue

La ubicación de ejecución debe decidirse según dónde estén los
repositorios.

### Opción A: equipo local

Adecuado si DevBot necesita acceder a repositorios y herramientas
instaladas en el ordenador del desarrollador.

- Ejecutar el bot como proceso persistente.
- Mantener los repositorios en el entorno local.
- Configurar reinicio automático.
- Proteger el archivo `.env`.
- Mantener copias de seguridad de SQLite.

### Opción B: VPS

Adecuado si los proyectos y herramientas de compilación están
disponibles en Linux.

- Ejecutar como usuario sin privilegios.
- Utilizar un servicio como systemd.
- Configurar almacenamiento persistente.
- Configurar logs y reinicio automático.

### Opción C: arquitectura híbrida

Un bot alojado remotamente y un worker local que ejecuta tareas en el
equipo de desarrollo. Requiere diseñar autenticación mutua, transporte
seguro y autorización de trabajos. No es necesaria para el primer MVP.

**Decisión pendiente:** elegir entorno de despliegue. No asumir que
Railway puede acceder a los repositorios locales del desarrollador.

## 16. Criterios de finalización del MVP

El MVP se considera terminado cuando:

- El bot funciona en un servidor de Discord privado.
- Solo usuarios autorizados pueden utilizarlo.
- Los proyectos y tareas están persistidos.
- Se puede ejecutar una tarea registrada de forma manual.
- Las ejecuciones tienen timeout y control de concurrencia.
- Los resultados quedan guardados y se pueden consultar.
- Se pueden programar tareas recurrentes.
- Las ejecuciones programadas generan notificaciones.
- El motor no depende de Discord.
- Las pruebas principales pasan.
- No existe una vía de ejecución arbitraria de comandos desde Discord.

## 17. Decisiones pendientes

Estas decisiones deben cerrarse antes de implementar las partes que
dependen de ellas:

Decisión Propuesta inicial Estado

---

Primera plataforma Discord **Confirmada**
IA Ninguna **Confirmada**
Lenguaje TypeScript Propuesta
Persistencia SQLite Propuesta
Concurrencia Una tarea a la vez Propuesta
Despliegue Local, VPS o híbrido Pendiente
Entorno de ejecución Windows, WSL o Linux Pendiente
Acceso Bot privado y allowlist Propuesta
Scheduler node-cron Propuesta

## 18. Primera tarea de desarrollo

Empezar exclusivamente por la Iteración 1.

No implementar todavía el runner, el scheduler, GitHub ni plugins.
Primero dejar una aplicación de Discord limpia, tipada, autenticada y
con slash commands registrados.

**Primer entregable:** un bot de Discord privado que responda `/help` y
`/status`, rechace usuarios no autorizados y registre eventos relevantes
sin exponer secretos.

---

## Principios del proyecto

- Primero funcionalidad, después abstracciones.
- Monolito modular antes que microservicios.
- Discord es un adaptador, no el núcleo.
- Las automatizaciones son explícitas y registradas.
- El mismo motor sirve para ejecución manual y programada.
- La seguridad forma parte del diseño inicial.
- No introducir IA en el MVP.
- Cada iteración debe dejar una versión ejecutable y comprobable.
