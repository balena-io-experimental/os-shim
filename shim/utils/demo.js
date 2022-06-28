const { promises: fs } = require('fs');
const path = require('path');
const { promisify } = require('util');
const { Shim } = require('../build/app');

const sleep = promisify(setTimeout);

(async () => {
    // Paths in shim_child container
    const baseDir = '/mnt/root/demo';
    const demoJsonPath = path.join(baseDir, '/config.json');
    const watchDir = path.join(baseDir, '/vpn_status');

    // Paths on host
    const vpnFileOnHost = path.resolve(__dirname, '../demo/vpn_status/active');
    const demoJsonOnHost = path.resolve(__dirname, '../demo/config.json');
    const demoJsonBackupOnHost = path.resolve(__dirname, '../demo/config.backup.json');
    try {
        const shim = new Shim(
            await Shim.WithChild()
        );

        // ------------------
        console.log('\n##### DEMO A: READING FROM FILE #####');

        console.log('\t1. READING DEMO.JSON:');
        console.log(JSON.parse(await shim.read(demoJsonPath)));

        // ------------------
        console.log('\n##### DEMO B: WRITING TO FILE #####');

        console.log('\t1. WRITING \'{ test: "asdf" }\' TO DEMO.JSON')
        await shim.write(demoJsonPath, JSON.stringify({ test: 'asdf'}));

        console.log('\t2. READING DEMO.JSON:');
        console.log(JSON.parse(await shim.read(demoJsonPath)));

        // ------------------
        console.log('\n##### DEMO C: WATCHING FOR FILE / DIRECTORY CHANGES #####');
        console.log('\t1. STARTING FILE WATCHER');
        const watcher = await shim.watch(
            watchDir, 
            { 
                onAdd: (file) => console.log('\t\tADDED FILE:', file),
                onUnlink:  (file) => console.log('\t\tUNLINKED FILE:', file),
                onChange:  (file) => console.log('\t\tCHANGED FILE:', file),
            });

        console.log('\t2. CREATING active FILE IN `vpn_status` DIR');
        await fs.writeFile(vpnFileOnHost, '');
        await sleep(1000);

        console.log('\t3. REMOVING active FILE FROM `vpn_status` DIR');
        await fs.unlink(vpnFileOnHost).catch(() => {});
        await sleep(1000);

        console.log('\t4. ADDING BACK active FILE');
        await fs.writeFile(vpnFileOnHost, '');
        await sleep(1000);

        console.log('\t5. CHANGING active FILE');
        await fs.writeFile(vpnFileOnHost, '0');
        await sleep(1000);

        console.log('\t6. REMOVING active FILE AGAIN');
        await fs.unlink(vpnFileOnHost).catch(() => {});
        await sleep(1000);

        console.log('\t7. STOPPING WATCHER');
        watcher.close();
    } catch (err) {
        console.error(err);
    } finally {
        // ------------------
        console.log('\n##### RESTORING ORIGINAL DEMO.JSON #####');
        await fs.writeFile(
            demoJsonOnHost,
            await fs.readFile(demoJsonBackupOnHost)
        );
    }
    
})();