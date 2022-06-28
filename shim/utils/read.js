const { promises: fs } = require('fs');
const path = require('path');

const { getArgs } = require('./lib');

/**
 * Given a file path from stdin, outputs file contents to stdout.
 * Writes errors to stderr if present.
 */
(async () => {
    const [ filePath ] = getArgs(process.argv);
    const absoluteFilePath = path.resolve(__dirname, filePath);
    try {
        const contents = await fs.readFile(absoluteFilePath, 'utf-8');
        console.log(contents);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
    process.exit(0);
})();
