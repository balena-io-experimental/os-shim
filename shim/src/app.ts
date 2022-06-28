import * as Dockerode from 'dockerode';
import { PassThrough } from 'stream';

const docker = new Dockerode({ socketPath: process.env.DOCKER_HOST ?? '/var/run/docker.sock' });

type ShimOption = (s: Shim) => void;

export class Shim {
    public static readonly PARENT_CONTAINER_NAME = process.env.PARENT_CONTAINER_NAME ?? 'shim_parent';
    public static readonly CHILD_CONTAINER_NAME = process.env.CHILD_CONTAINER_NAME ?? 'shim_child';
    public static readonly PARENT_MOUNT_PATH = process.env.PARENT_MOUNT_PATH ?? '/';
    public static readonly CHILD_MOUNT_PATH = process.env.CHILD_MOUNT_PATH ?? '/mnt/root';

    private container: Dockerode.Container;

    constructor(init: ShimOption) {
        // Initialize and set this.container
        // Shim should be initialized using the static `WithChild` method, like so:
        // `const shim = new Shim(await Shim.WithChild('my_shim', 'alpine'));`
        init(this);
    }

    public static async WithChild(containerName: string = Shim.CHILD_CONTAINER_NAME, imageName?: string): Promise<ShimOption> { 
        const baseImage = await this.getParentImage(containerName, imageName);
        const container = await this.createChildContainer(containerName, baseImage);
        return (s: Shim) => {
            s.container = container;
        }
    }

    private static async getParentImage(containerName: string, imageName?: string): Promise<Dockerode.ImageInspectInfo['RepoTags'][0]> {
        // Prefer image from arguments
        if (imageName) {
            try {
                await docker.pull(imageName);
                const image = await docker.getImage(imageName);
                return (await image.inspect()).RepoTags[0];
            } catch (err) {
                console.error(`${imageName} is not a valid image. Do you have the correct repository access?`);
                // Image not available remotely or locally.
                // This is a client error and means the user intended to run a Shim based 
                // on some custom image, but made a typo; thus we shouldn't try to recover from it.
                throw err;
            }
        }

        // Default to image used by running shim parent container;
        // The container is assumed to be running.
        const maybeShimContainer = await Shim.findContainer(({ Names }) =>
            Names.some(name => name.match(Shim.PARENT_CONTAINER_NAME))
        );

        if (!maybeShimContainer) {
            throw new Error(`Image for parent container ${Shim.PARENT_CONTAINER_NAME} not found, cannot initialize shim child`);
        }

        return maybeShimContainer.Image;
    }

    private static async createChildContainer(containerName: string, parentImageId: string): Promise<Dockerode.Container> {
        try {
            // Don't create container if name already exists
            const maybeContainer = await Shim.findContainer(({ Names }) =>
                Names.some(name => name.match(containerName))
            );
            // TODO: maybe don't assume container is always running
            if (maybeContainer) {
                console.debug(`Container with name ${containerName} already exists, using existing container`);
                return await docker.getContainer(maybeContainer.Id);
            }

            const container = await docker.createContainer({
                Image: parentImageId,
                AttachStdout: false,
                AttachStderr: false,
                Cmd: ['sleep', 'infinity'],
                HostConfig: {
                    Binds: [
                        `${Shim.PARENT_MOUNT_PATH}:${Shim.CHILD_MOUNT_PATH}`
                    ],
                    Privileged: true
                }
            });
            await container.rename({ name: containerName });
            await container.start();
            return container;
        } catch (err: unknown) {
            console.error(`Error creating container: ${err}`);
            throw err;
        }
    }

    public static async findContainer(filterFn: (ctn: Dockerode.ContainerInfo) => boolean) {
        const containers = await docker.listContainers({ all: true });
        const container = containers.find(filterFn);
        return container ?? null;
    }

    private async getExecInstance(command: string, opts?: Dockerode.ExecCreateOptions) {
        return await this.container.exec({ Cmd: ['sh', '-c', command], ...opts });
    }

    /**
     * Executes a command in shim child container,
     * resolving with container stdout, and rejecting with stderr.
     */
    private async executeCommand(command: string): Promise<string> {
        // TODO: Assumes container is using shim parent's base image
        const execInstance = await this.getExecInstance(
            command,
            { AttachStdin: false, AttachStdout: true, AttachStderr: true }
        );

        const stream = await execInstance.start({});
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        docker.modem.demuxStream(stream, stdout, stderr);
        
        return new Promise((resolve, reject) => {
            let result = '';
            let error = '';
            stdout.on('data', (chunk) => {
                result += chunk.toString();
            });
            stderr.on('data', (chunk) => {
                error += chunk.toString();
            });
            stream.on('end', () => {
                if (error) {
                    reject(error);
                }
                resolve(result);
            });
        });
    }

    /**
     * Reads a file on the host OS through the shim child container's bind mount. The file path
     * should be an absolute path headed by Shim.CHILD_MOUNT_PATH.
     */
    public async read(file: string, command?: string): Promise<string> {
        // TODO: Assumes container is using shim parent's base image
        try {
            return await this.executeCommand(command ?? `node utils/read.js ${file}`);
        } catch (err) {
            console.error(`Error while reading ${file}: `, err);
            throw err;
        }
    }

    /**
     * Writes to a file on the host OS through the shim child container's bind mount. 
     * The file path should be an absolute path headed by Shim.CHILD_MOUNT_PATH.
     */
    public async write(file: string, content: string, command?: string): Promise<void> {
        // TODO: Assumes container is using shim parent's base image
        try {
            await this.executeCommand(command ?? `node utils/write.js ${file} '${JSON.stringify(content)}'`);
        } catch (err) {
            console.error(`Error while writing to ${file}: `, err);
            throw err;
        }
    }

    public async watch(
        fileOrDir: string, 
        listeners: { 
            onAdd?: Function, 
            onUnlink?: Function,
            onChange?: Function,
        },
        command?: string
    ) {
        const execInstance = await this.getExecInstance(
            command ?? `node utils/watch.js ${fileOrDir}`,
            { AttachStdin: true, AttachStdout: true, AttachStderr: true, Tty: true }
        );
        // See https://docs.docker.com/engine/api/v1.41/#operation/ContainerAttach
        const stream = await execInstance.start({ hijack: true, stdin: true });
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        docker.modem.demuxStream(stream, stdout, stderr);

        stdout.on('data', (chunk) => {
            const data = chunk.toString();
            // TODO: make more DRY
            if (data.match('add') && listeners.onAdd) {
                listeners.onAdd(data.replace('add', '').trim());
            }
            if (data.match('unlink') && listeners.onUnlink) {
                listeners.onUnlink(data.replace('unlink', '').trim());
            }
            if (data.match('change') && listeners.onChange) {
                listeners.onChange(data.replace('change', '').trim());
            }
        });
        stderr.on('data', (chunk) => {
            console.error(`File watcher encountered error: ${chunk.toString()}`);
            stream.write('\u0003');
        });
        return {
            close: () => {
                stream.write('\u0003');
            }
        }
    }
}
