import gulp from 'gulp';
const {series, watch, src, dest, parallel} = gulp;

import pump from 'pump';
//const pump = require('pump');
import path from 'path';
//const path = require('path');
import releaseUtils from '@tryghost/release-utils';
//const releaseUtils = require('@tryghost/release-utils');
import inquirer from 'inquirer';
//const inquirer = require('inquirer');

// gulp plugins and utils
import livereload from 'gulp-livereload';
//const livereload = require('gulp-livereload');
import postcss from 'gulp-postcss';
//const postcss = require('gulp-postcss');
import zip from 'gulp-zip';
import concat from 'gulp-concat';
//const concat = require('gulp-concat');
import uglify from 'gulp-uglify';
//const uglify = require('gulp-uglify');
import fs from 'fs';
//const fs = require('fs');

// postcss plugins
import autoprefixer from 'autoprefixer';
import cssnano from 'cssnano';
import easyimport from 'postcss-easy-import';
//const autoprefixer = require('autoprefixer');
//const cssnano = require('cssnano');
//const easyimport = require('postcss-easy-import');
import { readFile } from 'fs/promises';

const REPO = 'TryGhost/Source';
const REPO_READONLY = 'TryGhost/Source';
const CHANGELOG_PATH = path.join(process.cwd(), '.', 'changelog.md');

function serve(done) {
    livereload.listen();
    done();
}

const handleError = (done) => {
    return function (err) {
        return done(err);
    };
};

function hbs(done) {
    pump([
        src(['*.hbs', 'partials/**/*.hbs']),
        livereload()
    ], handleError(done));
}

function css(done) {
    pump([
        src('assets/css/screen.css', {sourcemaps: true}),
        postcss([
            easyimport,
            autoprefixer(),
            cssnano()
        ]),
        dest('assets/built/', {sourcemaps: '.'}),
        livereload()
    ], handleError(done));
}

function js(done) {
    pump([
        src([
            // pull in lib files first so our own code can depend on it
            'assets/js/lib/*.js',
            'assets/js/*.js'
        ], {sourcemaps: true}),
        concat('source.js'),
        uglify(),
        dest('assets/built/', {sourcemaps: '.'}),
        livereload()
    ], handleError(done));
}

function zipper(done) {
   // const filename = require('./package.json').name + '.zip';
    const filename = 'source.zip';

    pump([
        src([
            '**',
            '!node_modules', '!node_modules/**',
            '!dist', '!dist/**',
            '!yarn-error.log',
            '!yarn.lock',
            '!gulpfile.js'
        ]),
        zip(filename),
        dest('dist/')
    ], handleError(done));
}

const cssWatcher = () => watch('assets/css/**', css);
const jsWatcher = () => watch('assets/js/**', js);
const hbsWatcher = () => watch(['*.hbs', 'partials/**/*.hbs'], hbs);
const watcher = parallel(cssWatcher, jsWatcher, hbsWatcher);
const build = series(css, js);

export { build };
const zipped = series(build, zipper);
export { zipped as zip };
const defaultExport = series(build, serve, watcher);
export default defaultExport;

const release = async () => {
    // @NOTE: https://yarnpkg.com/lang/en/docs/cli/version/
    // require(./package.json) can run into caching issues, this re-reads from file everytime on release
    let packageJSON = JSON.parse(fs.readFileSync('./package.json'));
    const newVersion = packageJSON.version;

    if (!newVersion || newVersion === '') {
        console.log(`Invalid version: ${newVersion}`);
        return;
    }

    console.log(`\nCreating release for ${newVersion}...`);

    const githubToken = process.env.GST_TOKEN;

    if (!githubToken) {
        console.log('Please configure your environment with a GitHub token located in GST_TOKEN');
        return;
    }

    try {
        const result = await inquirer.prompt([{
            type: 'input',
            name: 'compatibleWithGhost',
            message: 'Which version of Ghost is it compatible with?',
            default: '5.0.0'
        }]);

        const compatibleWithGhost = result.compatibleWithGhost;

        const releasesResponse = await releaseUtils.releases.get({
            userAgent: 'Source',
            uri: `https://api.github.com/repos/${REPO_READONLY}/releases`
        });

        if (!releasesResponse || !releasesResponse) {
            console.log('No releases found. Skipping...');
            return;
        }

        let previousVersion = releasesResponse[0].tag_name || releasesResponse[0].name;
        console.log(`Previous version: ${previousVersion}`);

        const changelog = new releaseUtils.Changelog({
            changelogPath: CHANGELOG_PATH,
            folder: path.join(process.cwd(), '.')
        });

        changelog
            .write({
                githubRepoPath: `https://github.com/${REPO}`,
                lastVersion: previousVersion
            })
            .sort()
            .clean();

        const newReleaseResponse = await releaseUtils.releases.create({
            draft: true,
            preRelease: false,
            tagName: 'v' + newVersion,
            releaseName: newVersion,
            userAgent: 'Source',
            uri: `https://api.github.com/repos/${REPO}/releases`,
            github: {
                token: githubToken
            },
            content: [`**Compatible with Ghost ≥ ${compatibleWithGhost}**\n\n`],
            changelogPath: CHANGELOG_PATH
        });
        console.log(`\nRelease draft generated: ${newReleaseResponse.releaseUrl}\n`);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

export { release };
