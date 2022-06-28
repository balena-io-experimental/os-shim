const path = require('path');
const chokidar = require('chokidar');

const { getArgs } = require('./lib');

/**
 * Given a file or directory path,
 * watches file or directory for changes
 * Writes errors to stderr if present.
 */
(async () => {
    const [ fileOrDirPath ] = getArgs(process.argv);
    const absolutePath = path.resolve(__dirname, fileOrDirPath);

    // Set up file or dir watcher
    const watcher = chokidar.watch(absolutePath, {
        persistent: true,
        // TODO: assumes access to `inotify`; should use polling if `inotify-tools` not installed
        usePolling: false,
    })
        .on('error', (err) => {
            console.error(err);
            watcher.close().then(() => process.exit(1));
        })
        .on('add', (p) => console.log('add', path.basename(p)))
        .on('unlink', (p) => console.log('unlink', path.basename(p)))
        .on('change', (p) => console.log('change', path.basename(p)));
    
    // Set up stdin watcher for exit command
    const stdin = process.stdin;
    stdin.setEncoding('utf-8');
    if (stdin.isTTY) {
        // Don't wait for enter key to send data events
        stdin.setRawMode(true);
    }
    stdin.on('readable', () => {
        const data = process.stdin.read();
        // If Ctrl + c, exit
        if (data.match('\u0003')) {
            console.log('shim_child: Received Ctrl + c keypress');
            watcher.close().then(() => process.exit(0));
        }
    });
})();
