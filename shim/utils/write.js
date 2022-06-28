const fs = require('fs');
const path = require('path');

const { getArgs } = require('./lib');

/**
 * Given a file path and file contents from stdin,
 * writes contents to path then exits.
 * Writes errors to stderr if present.
 */
(async () => {
    const [ filePath, contents ] = getArgs(process.argv);
    const absoluteFilePath = path.resolve(__dirname, filePath);
    const writeStream = fs.createWriteStream(absoluteFilePath);
    writeStream
        .on('error', (err) => {
            console.error(err);
            process.exit(1);
        });
    writeStream.end(contents, () => {
        console.log(true);
        process.exit(0);
    });
})();
