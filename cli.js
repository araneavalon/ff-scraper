'use strict';

import yargs from 'yargs';
import path from 'path';
import debug from 'debug';

import { FFScraper } from './src/ff';
import { exportOutput } from './src/export';


function scraperOptions( yargs ) {
	return yargs
		.option( 'category', {
			nargs: 1,
			default: 'anime/RWBY',
			describe: 'Fanfiction category to scrape.',
		} )
		.option( 'dump-html', {
			describe: 'Save the body of all http requests made during the scrape.',
		} );
}

function getScraper( argv ) {
	return new FFScraper( {
		uuid: argv.key,
		category: argv.category,
		outDir: argv[ 'out-dir' ],
		dumpHtml: argv[ 'dump-html' ],
		queue: {
			minDelay: 500,
			maxDelay: 750,
		},
	} );
}

function finish( promise ) {
	return promise
		.then( () => process.exit( 0 ) )
		.catch( ( error ) => {
			console.error( error.statusCode, error.message );
			process.exit( 1 );
		} );
}

yargs
	.version( false )
	.option( 'verbose', {
		alias: 'v',
		describe: 'Enable verbose debug output.',
		coerce: ( value ) => {
			if( value ) {
				if( typeof value === 'string' ) {
					debug.enable( value.split( ',' ).map( ( v ) => `ff:${v}` ).join( ',' ) );
				} else {
					debug.enable( 'ff:*' );
				}
			}
			return value;
		},
	} )
	.option( 'key', {
		alias: 'k',
		nargs: 1,
		describe: 'Key of existing load to continue.',
	} )
	.option( 'out-dir', {
		nargs: 1,
		default: `.${path.sep}output`,
		parse: path.normalize,
		describe: 'Specify the output directory.',
	} )
	.command(
		'pages',
		'Download story headers from ff.net that match the provided category.',
		( yargs ) => {
			scraperOptions( yargs );
		},
		( argv ) => {
			finish( getScraper( argv ).getPages( 1, null ) );
		} )
	.command(
		'chapters',
		'Download chapters from existing story headers.',
		( yargs ) => {
			scraperOptions( yargs )
				.demandOption( 'key' );
		},
		( argv ) => {
			finish( getScraper( argv ).getChaptersFromExisting() );
		}	)
	.command(
		'update',
		'Download new stories and chapters until a story is found with an unchanged updated date.',
		( yargs ) => {
			scraperOptions( yargs )
				.demandOption( 'key' );
		},
		( argv ) => {
			finish( getScraper( argv ).updateExisting() );
		} )
	.command(
		'export',
		'Clean up data to make it more suitable for zipping and exporting.',
		( yargs ) => {
			yargs
				.option( 'export-dir', {
					nargs: 1,
					default: `.${path.sep}export`,
					parse: path.normalize,
					describe: 'Specify the export directory.',
				} )
				.demandOption( 'key' );
		},
		( argv ) => {
			finish( exportOutput( argv.key, argv[ 'out-dir' ], argv[ 'export-dir' ] ) );
		} )
	.demandCommand()
	.help()
	.argv;
