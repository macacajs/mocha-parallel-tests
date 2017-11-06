'use strict';

import assert from 'assert';
import path from 'path';
import Reporter from './lib/reporter';
import {createInstance as createRunnerInstance} from './lib/runner';
import prepareRequire from './lib/utils/prepare-require';
import RequireCacheWatcher from './lib/utils/require-cache-watcher';
import {
    patch as patchGlobalHooks,
    restore as restoreGlobalHooks
} from './lib/utils/hooks';

import {
    addTest,
    runTests,
    setOptions as setWatcherOptions
} from './lib/watcher';

// files lookup in mocha is complex, so it's better to just run original code
import {lookupFiles as mochaLookupFiles} from 'mocha/lib/utils';
import processRequireOption from './lib/utils/process-require-option';

export default function binHelper(options) {
    process.setMaxListeners(0);

    if (typeof options.compilers === 'string') {
        options.compilers = [options.compilers];
    }

    const extensions = ['js'];
    (options.compilers || []).forEach(compiler => {
        const [ext, mod] = compiler.split(':');
        let compilerMod = mod;

        if (mod[0] === '.') {
            compilerMod = path.join(process.cwd(), mod);
        }

        require(prepareRequire(compilerMod));
        extensions.push(ext);
    });

    // --no-timeouts option
    if (typeof options.timeouts === 'boolean') {
        options.enableTimeouts = options.timeouts;
    }

    // require --require'd files
    processRequireOption(options);

    // default files to test/*.{js,coffee}
    const patterns = (options._ || []).slice(2);
    if (!patterns.length) {
        patterns.push('test');
    }

    // get test files with original mocha utils.lookupFiles() function
    let files = [];
    patterns.forEach(testPath => {
        try {
            files = files.concat(mochaLookupFiles(testPath, extensions, options.recursive));
        } catch (ex) {
            if (ex.message.startsWith('cannot resolve path')) {
                console.error(`Warning: Could not find any test files matching pattern: ${testPath}`); // eslint-disable-line no-console
                return;
            }

            throw ex;
        }
    });

    assert(files.length, 'No test files found');

    // time to create our own runner
    const customRunner = createRunnerInstance();

    // watcher monitors running files
    setWatcherOptions({
        maxParallelTests: options.maxParallel,
        retryCount: options.retry
    });

    // require(testFile) needs some global hooks (describe, it etc)
    patchGlobalHooks();

    const cacheWatcher = new RequireCacheWatcher;
    cacheWatcher.start();

    files.forEach(file => {
        // does this file have a syntax error?
        // require() will show that
        const absFilePath = path.resolve(file);
        require(absFilePath);

        addTest(absFilePath);
    });

    // okay, all files are valid JavaScript
    // now it's time for mocha to set its own global hooks
    restoreGlobalHooks();

    // also we need to delete files from require.cache
    // which are involved into all tests
    const cacheMark = cacheWatcher.getStateMark();
    cacheWatcher.flushRequireCache(cacheMark);

    runTests({
        options: Object.assign({}, options, {
            reporterName: options.R || options.reporter,
            reporter: Reporter,
            testsLength: files.length
        })
    });

    return new Promise((resolve) => {
        customRunner.on('end', resolve);
    });
}
