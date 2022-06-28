# Shim

## Quickstart

### Demo
```bash
cd shim
npm run demo
```

### Deploy
```bash
balena push $APP
```

## Purpose
For allowing any container with access to the Engine socket to interface with the Host OS filesystem. Useful on balenaOS, where bind mounts are not (yet) allowed. 

### How does it work?
A common scenario one may have in an environment such as balenaOS, is the need to interact with some arbitrary aspect of the Host OS's filesystem. Usually this may be done using bind mounts, but bind mounts are restricted in the balenaOS environment. However, containers *do* have access to `io.balena.features.balena-socket`, the [Engine socket label](https://www.balena.io/docs/reference/supervisor/docker-compose/#labels), which allows containers to communicate with the Engine over its Unix socket.

With this socket, containers have access to the full set of Docker commands, including creating new containers with bind mounts.

This allows containers to bind mount to `/` on the Host OS, enabling interfacing with any file or directory. That's essentially what this repository showcases. Feel free to [contribute](https://github.com/balena-io-playground/os-shim/issues), as this is a working proof of concept, but lacks polish :).

> Warning: Use this concept at your own risk! A write to the wrong location can and will brick your balenaOS device.


## API
When running the demo with `npm run demo`, there are two containers running at any time: `shim_parent` and `shim_child`. `shim_parent` manages an instance of `Shim` and passes commands using Dockerode's equivalent of `docker exec` to `shim_child`. `shim_child` contains the scripts located in `utils` for reading, writing, or watching some location in the host filesystem.

### Container env vars
Env vars for `shim_parent` may be specified in `docker-compose.yml`. Valid env vars are the following:

Env var | Type | Default
--- | --- | ---
`PARENT_CONTAINER_NAME` | string | shim_parent
`CHILD_CONTAINER_NAME` | string | shim_child
`PARENT_MOUNT_PATH` | string | /
`CHILD_MOUNT_PATH` | string | /mnt/root

`*_CONTAINER_NAME` is self-explanatory. `*_MOUNT_PATH` determines the bind mount configuration used when creating `shim_child`. The default values here are equivalent to calling `docker run` with `-v /:/mnt/root`, bind mounting host root to container `/mnt/root`.

> You may have also noticed `process.env.DOCKER_HOST` in the codebase. When running this container on balenaOS, the Engine socket feature label described previously tells the device Supervisor to bind mount the host socket into the container.

### Instantiation
The Shim class should be instantiated with the static `WithChild` method:

```typescript
public static async WithChild(
    containerName: string = Shim.CHILD_CONTAINER_NAME,
    imageName?: string
): Promise<ShimOption>
```

Like so:
```typescript
const shim = new Shim(
    await Shim.WithChild('my_container', 'my_image')
);
```

#### `containerName`
The child container name. Defaults to `Shim.CHILD_CONTAINER_NAME`.

#### `imageName`
Optional; if provided and valid, the given `imageName` will serve as the source image for the shim child container.

> This proof of concept assumes the existence of certain tools or packages in the base image: `inotify-tools`, NPM's [`chokidar`](https://www.npmjs.com/package/chokidar), and NPM's [`dockerode`](https://www.npmjs.com/package/dockerode). While custom commands may be passed that make `inotify-tools` or `chokidar` unnecessary, `dockerode` will always be required. Thus, if specifying an alternate base image, make sure the image at least has Dockerode.


### `Shim.prototype.read`
Reads a file on the host OS through the shim child container's bind mount.

```typescript
public async read(
    file: string, 
    command?: string
): Promise<string>
```

#### `file`
File path on host OS, headed by `Shim.CHILD_MOUNT_PATH`. Should be an absolute path.

#### `command`
An optional custom command for reading files from the host. By default, `utils/read.js` is used.


### `Shim.prototype.write`
Writes to a file on the host OS through the shim child container's bind mount.

```typescript
public async write(
    file: string, 
    content: string, 
    command?: string
): Promise<void>
```

#### `file`
File path on host OS, headed by `Shim.CHILD_MOUNT_PATH`. Should be an absolute path.

#### `content`
Content to write to file.

#### `command`
An optional custom command for writing to files on the host. By default, `utils/write.js` is used.


### `Shim.prototype.watch`
Uses `chokidar` to watch files or directories on the host OS. Disables polling (utilized by `fs.watchFile`), which is inferior in terms of performance. Instead, `watch` utilizes `fs.watch` which interfaces with Unix's `inotify-tools` under the hood. Read [here](https://nodejs.org/dist/latest-v16.x/docs/api/fs.html#fswatchfilefilename-options-listener) for more information about the differences between these two `fs` methods. 

```typescript
public async watch(
    fileOrDir: string, 
    listeners: { 
        onAdd?: Function, 
        onUnlink?: Function,
        onChange?: Function,
    },
    command?: string
): Promise<{ close: () => void }>
```

Returns an object with the close method, which writes `\u0003` (Ctrl + c) to the shim child watch process's `stdin`, thus closing it.

#### `fileOrDir`
File or dir path to watch. Should be an absolute path, headed by `Shim.CHILD_MOUNT_PATH`.

#### `listeners`
A map of zero or more listeners which the method calls on various filesystem events:
- `add` when a file is created
- `unlink` when a file is removed
- `change` when a file is updated

The listeners are passed the filename of the file that received the update. Only the filename is provided, not the entire path to the file.

#### `command`
An optional custom command for watching files on the host. By default, `utils/watch.js` is used.\
