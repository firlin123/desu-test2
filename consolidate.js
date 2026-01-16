// @ts-check
const { execSync } = require('child_process');
const { readFileSync, writeFileSync, existsSync, renameSync } = require('fs');

/** @type {typeof import('child_process').execSync} */
const execWEnv = /** @type {any} */ (
    /** @type {(cmd: string, options: import('child_process').ExecSyncOptions) => string} */
    ((cmd, options) => {
        options = options || {};
        return execSync(cmd, Object.assign({}, options, { env: process.env }));
    })
);

// =============================================================
// CONFIGURATION
// =============================================================

// Manifest file path
const MANIFEST = process.env.MANIFEST || 'manifest.json';

// Internet Archive item ID for uploads
const IA_ITEM_ID = process.env.IA_ITEM_ID || 'test1_202512';
const IA_EMAIL = process.env.IA_EMAIL || '';
const IA_PASSWORD = process.env.IA_PASSWORD || '';

// 2012-02-17 05:39:50 UTC is the date of the first /mlp/ post
const BASE_YEAR = parseInt(process.env.BASE_YEAR || '2012', 10);
const BASE_MONTH = parseInt(process.env.BASE_MONTH || '2', 10);
const BASE_DAY = parseInt(process.env.BASE_DAY || '17', 10);
const BASE_HOUR = parseInt(process.env.BASE_HOUR || '5', 10);
const BASE_MINUTE = parseInt(process.env.BASE_MINUTE || '39', 10);
const BASE_SECOND = parseInt(process.env.BASE_SECOND || '50', 10);

// Thresholds for forced consolidation
const MONTHLY_THRESHOLD = parseInt(process.env.MONTHLY_THRESHOLD || '32', 10);
const YEARLY_THRESHOLD = parseInt(process.env.YEARLY_THRESHOLD || '13', 10);

// =============================================================
// ENVIRONMENT CHECKS
// =============================================================

for (const cmd of ['jq', 'gh', 'xz', 'node']) {
    try {
        execWEnv(`command -v ${cmd}`, { stdio: 'ignore' });
    } catch {
        console.error(`Required command '${cmd}' not found. Please install it and retry.`);
        process.exit(1);
    }
}

try {
    execWEnv('command -v ia', { stdio: 'ignore' });
} catch {
    console.error("'ia' CLI not found. Install with 'pip install internetarchive' and configure with 'ia configure'.");
    process.exit(1);
}

if (!existsSync(MANIFEST)) {
    console.error(`'${MANIFEST}' not found.`);
    process.exit(1);
}

// =============================================================
// HELPER FUNCTIONS
// =============================================================

/**
 * Commit changes and tag the repository if not already done.
 * 
 * @param {string} tagName
 * @returns {boolean}
 */
function commitAndTag(tagName) {
    try {
        const logOutput = execWEnv('git log --format=%s', { encoding: 'utf-8' });
        if (!logOutput.split('\n').includes(tagName)) {
            execWEnv(`git add ${MANIFEST}`);
            execWEnv(`git commit -m "${tagName}"`);
            execWEnv('git push');
        }
        try {
            execWEnv(`git rev-parse ${tagName}`, { stdio: 'ignore' });
        } catch {
            execWEnv(`git tag ${tagName}`);
            execWEnv(`git push origin ${tagName}`);
        }
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Pad a number with leading zeros to ensure two digits.
 * 
 * @param {number} num
 * @returns {string}
 */
function pad(num) {
    return String(num).padStart(2, '0');
}

/**
 * Get the day label (YYYY-MM-DD) for a given raw timestamp string.
 * 
 * @param {string} raw
 * @returns {string}
 */
function getDayLabel(raw) {
    const dateStr = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    const timeStr = `${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}`;

    const currTS = new Date(`${dateStr} ${timeStr} UTC`).getTime();
    const prev = new Date(`${dateStr} ${pad(BASE_HOUR)}:${pad(BASE_MINUTE)}:${pad(BASE_SECOND)} UTC`);
    const next = new Date(prev);
    next.setUTCDate(next.getUTCDate() + 1);
    if (currTS < prev.getTime()) {
        // Before base time, shift the comparison window back one day
        prev.setUTCDate(prev.getUTCDate() - 1);
        next.setUTCDate(next.getUTCDate() - 1);
    }
    const diffPrev = currTS - prev.getTime();
    const diffNext = next.getTime() - currTS;
    const chosenTS = diffPrev <= diffNext ? prev : next;
    const chosenDate = new Date(chosenTS);

    return `${chosenDate.getUTCFullYear()}-${pad(chosenDate.getUTCMonth() + 1)}-${pad(chosenDate.getUTCDate())}`;
}

/**
 * Get the month label (YYYY-MM) for a given raw timestamp string.
 * 
 * @param {string} raw
 * @returns {string}
 */
function getMonthLabel(raw) {
    const ymStr = `${raw.slice(0, 4)}-${raw.slice(4, 6)}`;
    const dhmsStr = `${raw.slice(6, 8)} ${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}`;

    const currTS = new Date(`${ymStr}-${dhmsStr} UTC`).getTime();
    const prev = new Date(`${ymStr}-${pad(BASE_DAY)} ${pad(BASE_HOUR)}:${pad(BASE_MINUTE)}:${pad(BASE_SECOND)} UTC`);
    const next = new Date(prev);
    next.setUTCMonth(next.getUTCMonth() + 1);
    if (currTS < prev.getTime()) {
        // Before base time, shift the comparison window back one month
        prev.setUTCMonth(prev.getUTCMonth() - 1);
        next.setUTCMonth(next.getUTCMonth() - 1);
    }

    const diffPrev = currTS - prev.getTime();
    const diffNext = next.getTime() - currTS;
    const chosenTS = diffPrev <= diffNext ? prev : next;
    const chosenDate = new Date(chosenTS);

    // YYYY-MM
    return `${chosenDate.getUTCFullYear()}-${pad(chosenDate.getUTCMonth() + 1)}`;
}

/**
 * Get the year label (YYYY) for a given raw timestamp string.
 * 
 * @param {string} raw
 * @returns {string}
 */
function getYearLabel(raw) {
    const yStr = `${raw.slice(0, 4)}`;
    const mdhmsStr = `${raw.slice(4, 6)}-${raw.slice(6, 8)} ${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}`;

    const currTS = new Date(`${yStr}-${mdhmsStr} UTC`).getTime();
    const prev = new Date(`${yStr}-${pad(BASE_MONTH)}-${pad(BASE_DAY)} ${pad(BASE_HOUR)}:${pad(BASE_MINUTE)}:${pad(BASE_SECOND)} UTC`);
    const next = new Date(prev);
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    if (currTS < prev.getTime()) {
        // Before base time, shift the comparison window back one year
        prev.setUTCFullYear(prev.getUTCFullYear() - 1);
        next.setUTCFullYear(next.getUTCFullYear() - 1);
    }

    const diffPrev = currTS - prev.getTime();
    const diffNext = next.getTime() - currTS;
    const chosenTS = diffPrev <= diffNext ? prev : next;
    const chosenDate = new Date(chosenTS);

    // YYYY
    return `${chosenDate.getUTCFullYear()}`;
}

/**
 * Upload the daily archive if it doesn't already exist.
 * 
 * @returns {boolean}
 */
function uploadDaily() {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'));
    const dailyList = manifest.daily || [];
    const dailyCount = dailyList.length;
    if (dailyCount <= 0) {
        return true;
    }
    const daily = dailyList[dailyCount - 1];
    try {
        execWEnv(`gh release view ${daily}`, { stdio: 'ignore' });
        console.log(`Daily release '${daily}' already exists. Skipping upload.`);
        return true;
    } catch {
        // Release does not exist, proceed with upload
    }
    const dailyMatch = daily.match(/^([0-9]{14})_daily_([0-9]+)_([0-9]+)$/);
    if (!dailyMatch) {
        console.error(`Invalid daily release name format: ${daily}`);
        return false;
    }
    const endTS = dailyMatch[1];
    const startPost = dailyMatch[2];
    const endPost = dailyMatch[3];
    console.log(`Preparing daily archive upload for release '${daily}'...`);
    const dailyFile = `${daily}.ndjson`;
    if (!existsSync(dailyFile)) {
        console.error(`Daily file '${dailyFile}' not found.`);
        return false;
    }
    console.log(`Compressing daily file '${dailyFile}'...`);
    const dailyXZ = `${dailyFile}.xz`;
    try {
        execWEnv(`xz -9e -c ${dailyFile} > ${dailyXZ}`);
    } catch {
        console.error(`Failed to compress daily file '${dailyFile}'.`);
        return false;
    }
    if (!commitAndTag(daily)) {
        console.error('Failed to commit and tag daily release.');
        return false;
    }
    console.log('Uploading daily archive to GitHub Releases...');
    const dateLabel = getDayLabel(endTS);
    try {
        execWEnv(`gh release create ${daily} ${dailyXZ} ` +
            `--title "${dateLabel} daily archive (${startPost} - ${endPost})" ` +
            `--notes "Automated daily scrape of /mlp/ posts for ${dateLabel}, covering posts ${startPost} to ${endPost}."`);
    } catch {
        console.error('Failed to create GitHub release for daily archive.');
        return false;
    }
    console.log(`Daily archive '${daily}' uploaded successfully.`);

    return true;
}

/**
 * Consolidate daily archives into a monthly archive if thresholds are met.
 * 
 * @returns {boolean}
 */
function consolidateMonthly() {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'));
    const dailyList = manifest.daily || [];
    const dailyCount = dailyList.length;
    if (dailyCount <= 0) {
        return true;
    }
    const lastDaily = dailyList[dailyCount - 1];
    const lastDailyMatch = lastDaily.match(/^([0-9]{14})_daily_[0-9]+_([0-9]+)$/);
    if (!lastDailyMatch) {
        console.error(`Invalid daily release name format: ${lastDaily}`);
        return false;
    }
    let endTS = lastDailyMatch[1];
    const endPost = lastDailyMatch[2];
    // Increment endTS by one second
    const endDate = new Date(`${endTS.slice(0, 4)}-${endTS.slice(4, 6)}-${endTS.slice(6, 8)} ${endTS.slice(8, 10)}:${endTS.slice(10, 12)}:${endTS.slice(12, 14)} UTC`);
    endDate.setUTCSeconds(endDate.getUTCSeconds() + 1);
    endTS = `${endDate.getUTCFullYear()}${pad(endDate.getUTCMonth() + 1)}${pad(endDate.getUTCDate())}${pad(endDate.getUTCHours())}${pad(endDate.getUTCMinutes())}${pad(endDate.getUTCSeconds())}`;
    const nextDate = new Date(endDate);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    if (dailyCount < MONTHLY_THRESHOLD && nextDate.getUTCDate() !== BASE_DAY) {
        return true;
    }
    const firstDaily = dailyList[0];
    const firstDailyMatch = firstDaily.match(/^[0-9]{14}_daily_([0-9]+)_[0-9]+$/);
    if (!firstDailyMatch) {
        console.error(`Invalid daily release name format: ${firstDaily}`);
        return false;
    }
    const startPost = firstDailyMatch[1];

    console.log(`Consolidating ${dailyCount} daily archives into a monthly archive...`);
    const monthly = `${endTS}_monthly_${startPost}_${endPost}`;
    const monthlyFile = `${monthly}.ndjson`;
    writeFileSync(monthlyFile, '');
    for (const daily of dailyList) {
        const dailyFile = `${daily}.ndjson`;
        if (!existsSync(dailyFile)) {
            const dailyXZ = `${dailyFile}.xz`;
            if (!existsSync(dailyXZ)) {
                console.log(`Downloading daily archive '${daily}' from GitHub Releases...`);
                try {
                    execWEnv(`gh release download ${daily} -p ${dailyXZ}`);
                } catch {
                    console.error(`Failed to download daily archive '${daily}'.`);
                    return false;
                }
            }
            console.log(`Decompressing daily archive '${dailyXZ}'...`);
            try {
                execWEnv(`xz -d -c ${dailyXZ} > ${dailyFile}`);
            } catch {
                console.error(`Failed to decompress daily archive '${dailyXZ}'.`);
                return false;
            }
        }
        execWEnv(`cat ${dailyFile} >> ${monthlyFile}`);
    }

    console.log('Running reCheck on monthly archive...');
    try {
        execWEnv(`node src/reCheck.js ${monthlyFile}`, { stdio: 'inherit' });
    } catch {
        console.error(`Monthly archive '${monthlyFile}' reCheck failed.`);
        return false;
    }

    console.log('Compressing monthly archive...');
    const monthlyXZ = `${monthlyFile}.xz`;
    try {
        execWEnv(`xz -9e -c ${monthlyFile} > ${monthlyXZ}`);
    } catch {
        console.error(`Failed to compress monthly archive '${monthlyFile}'.`);
        return false;
    }

    // Replace daily -> monthly in manifest
    manifest.daily = [];
    manifest.monthly = manifest.monthly || [];
    manifest.monthly.push(monthly);
    writeFileSync(MANIFEST + '.tmp', JSON.stringify(manifest, null, 2));
    renameSync(MANIFEST + '.tmp', MANIFEST);

    try {
        execWEnv(`gh release view ${monthly}`, { stdio: 'ignore' });
    } catch {
        if (!commitAndTag(monthly)) {
            console.error('Failed to commit and tag monthly release.');
            return false;
        }
        console.log('Uploading monthly archive to GitHub Releases...');
        const monthLabel = getMonthLabel(endTS);
        try {
            execWEnv(`gh release create ${monthly} ${monthlyXZ} ` +
                `--title "${monthLabel} monthly archive (${startPost} - ${endPost})" ` +
                `--notes "Automated consolidation of /mlp/ posts for ${monthLabel}, covering posts ${startPost} to ${endPost}."`);
        } catch {
            console.error('Failed to create GitHub release for monthly archive.');
            return false;
        }
    }

    console.log('Removing old daily releases...');
    for (const daily of dailyList) {
        console.log(`Deleting daily release '${daily}'...`);
        try {
            execWEnv(`gh release delete ${daily} -y`);
        } catch {
            console.warn(`WARN: Failed to delete daily release '${daily}'. Continuing...`);
        }
        try {
            execWEnv(`git push --delete origin ${daily}`);
        } catch {
            console.warn(`WARN: Failed to delete daily tag '${daily}' from remote. Continuing...`);
        }
        try {
            execWEnv(`git tag -d ${daily}`);
        } catch {
            console.warn(`WARN: Failed to delete daily tag '${daily}' locally. Continuing...`);
        }
    }

    console.log('Monthly consolidation complete.');
    return true;
}

/**
 * Consolidate monthly archives into a yearly archive if thresholds are met.
 * 
 * @returns {boolean}
 */
function consolidateYearly() {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf-8'));
    const monthlyList = manifest.monthly || [];
    const monthlyCount = monthlyList.length;
    if (monthlyCount <= 0) {
        return true;
    }
    const lastMonthly = monthlyList[monthlyCount - 1];
    const lastMonthlyMatch = lastMonthly.match(/^([0-9]{14})_monthly_[0-9]+_([0-9]+)$/);
    if (!lastMonthlyMatch) {
        console.error(`Invalid monthly release name format: ${lastMonthly}`);
        return false;
    }
    let endTS = lastMonthlyMatch[1];
    const endPost = lastMonthlyMatch[2];
    // Increment endTS by one second
    const endDate = new Date(`${endTS.slice(0, 4)}-${endTS.slice(4, 6)}-${endTS.slice(6, 8)} ${endTS.slice(8, 10)}:${endTS.slice(10, 12)}:${endTS.slice(12, 14)} UTC`);
    endDate.setUTCSeconds(endDate.getUTCSeconds() + 1);
    endTS = `${endDate.getUTCFullYear()}${pad(endDate.getUTCMonth() + 1)}${pad(endDate.getUTCDate())}${pad(endDate.getUTCHours())}${pad(endDate.getUTCMinutes())}${pad(endDate.getUTCSeconds())}`;
    const nextDate = new Date(endDate);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    if (monthlyCount < YEARLY_THRESHOLD && (nextDate.getUTCMonth() + 1 !== BASE_MONTH || nextDate.getUTCDate() < BASE_DAY)) {
        return true;
    }

    // Allow archives 2 days to settle before the reCheck
    const graceEndTS = new Date(endDate);
    graceEndTS.setUTCDate(graceEndTS.getUTCDate() + 2);
    const currTS = new Date();

    if (currTS.getTime() < graceEndTS.getTime()) {
        return true;
    }

    const firstMonthly = monthlyList[0];
    const firstMonthlyMatch = firstMonthly.match(/^[0-9]{14}_monthly_([0-9]+)_[0-9]+$/);
    if (!firstMonthlyMatch) {
        console.error(`Invalid monthly release name format: ${firstMonthly}`);
        return false;
    }
    const startPost = firstMonthlyMatch[1];

    try {
        execWEnv('ia configure --whoami', { stdio: 'ignore' });
    } catch {
        if (!IA_EMAIL || !IA_PASSWORD) {
            console.error("Internet Archive CLI not configured. Please provide IA_EMAIL and IA_PASSWORD environment variables or run 'ia configure' manually.");
            return false;
        }

        console.log('Configuring Internet Archive CLI...');
        try {
            execWEnv(`ia configure --username "${IA_EMAIL}" --password "${IA_PASSWORD}"`);
        } catch {
            console.error("Failed to configure Internet Archive CLI. Please check your credentials or run 'ia configure' manually.");
            return false;
        }

        console.log('Verifying Internet Archive CLI configuration...');
        try {
            execWEnv('ia configure --whoami', { stdio: 'ignore' });
        } catch {
            console.error("Internet Archive CLI configuration verification failed. Please check your credentials or run 'ia configure' manually.");
            return false;
        }

        console.log('Internet Archive CLI configured successfully.');
    }

    console.log(`Consolidating ${monthlyCount} monthly archives into a yearly archive...`);
    const yearly = `${endTS}_yearly_${startPost}_${endPost}`;
    const yearlyFile = `${yearly}.ndjson`;
    writeFileSync(yearlyFile, '');

    for (const monthly of monthlyList) {
        const monthlyFile = `${monthly}.ndjson`;
        if (!existsSync(monthlyFile)) {
            const monthlyXZ = `${monthlyFile}.xz`;
            if (!existsSync(monthlyXZ)) {
                console.log(`Downloading monthly archive '${monthly}' from GitHub Releases...`);
                try {
                    execWEnv(`gh release download ${monthly} -p ${monthlyXZ}`);
                } catch {
                    console.error(`Failed to download monthly archive '${monthly}'.`);
                    return false;
                }
            }
            console.log(`Decompressing monthly archive '${monthlyXZ}'...`);
            try {
                execWEnv(`xz -d -c ${monthlyXZ} > ${monthlyFile}`);
            } catch {
                console.error(`Failed to decompress monthly archive '${monthlyXZ}'.`);
                return false;
            }
        }
        execWEnv(`cat ${monthlyFile} >> ${yearlyFile}`);
    }

    console.log('Running reCheck on yearly archive...');
    try {
        execWEnv(`node src/reCheck.js ${yearlyFile}`, { stdio: 'inherit' });
    } catch {
        console.error(`Yearly archive '${yearlyFile}' reCheck failed.`);
        return false;
    }

    console.log('Compressing yearly archive...');
    const yearlyXZ = `${yearlyFile}.xz`;
    try {
        execWEnv(`xz -9e -c ${yearlyFile} > ${yearlyXZ}`);
    } catch {
        console.error(`Failed to compress yearly archive '${yearlyFile}'.`);
        return false;
    }

    const iaURL = `https://archive.org/download/${IA_ITEM_ID}/${yearlyXZ}`;
    // Replace monthly -> yearly in manifest
    manifest.monthly = [];
    manifest.yearly = manifest.yearly || [];
    manifest.yearly.push({ name: yearly, url: iaURL });
    writeFileSync(MANIFEST + '.tmp', JSON.stringify(manifest, null, 2));
    renameSync(MANIFEST + '.tmp', MANIFEST);

    // Check if it already exists in IA item
    try {
        const iaListOutput = execWEnv(`ia list ${IA_ITEM_ID}`, { encoding: 'utf-8' });
        if (!iaListOutput.split('\n').includes(yearlyXZ)) {
            console.log('Uploading yearly archive to Internet Archive...');
            try {
                execWEnv(`ia upload ${IA_ITEM_ID} ${yearlyXZ}`);
            } catch {
                console.error('Failed to upload yearly archive to Internet Archive.');
                return false;
            }
        }
    } catch {
        console.error('Failed to list items in Internet Archive. Please check your IA configuration.');
        return false;
    }
    if (!commitAndTag(yearly)) {
        console.error('Failed to commit and tag yearly release.');
        return false;
    }

    console.log('Removing old monthly releases...');
    for (const monthly of monthlyList) {
        console.log(`Deleting monthly release '${monthly}'...`);
        try {
            execWEnv(`gh release delete ${monthly} -y`);
        } catch {
            console.warn(`WARN: Failed to delete monthly release '${monthly}'. Continuing...`);
        }
        try {
            execWEnv(`git push --delete origin ${monthly}`);
        } catch {
            console.warn(`WARN: Failed to delete monthly tag '${monthly}' from remote. Continuing...`);
        }
        try {
            execWEnv(`git tag -d ${monthly}`);
        } catch {
            console.warn(`WARN: Failed to delete monthly tag '${monthly}' locally. Continuing...`);
        }
    }
    console.log('Yearly consolidation complete.');
    return true;
}

// =============================================================
// MAIN SCRIPT EXECUTION
// =============================================================

if (!uploadDaily()) {
    process.exit(1);
}

if (!consolidateMonthly()) {
    process.exit(1);
}

if (!consolidateYearly()) {
    process.exit(1);
}

console.log('Archive consolidation process completed successfully.');