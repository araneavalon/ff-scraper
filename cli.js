'use strict';

import yargs from 'yargs';
import path from 'path';
import debug from 'debug';

import { FFScraper } from './src/ff';


const argv = yargs
	.usage(
		'$0 <start> <end> [options]',
		'Download fics from ff.net that match the provided query and category.',
		( yargs ) => {
			yargs.positional( 'start', {
				describe: 'First page of results to scrape.',
				parse: ( value ) => Number.isNaN( value ) ? null : Number( value ),
			} );
			yargs.positional( 'end', {
				describe: 'Last page of results to scrape.',
				parse: ( value ) => Number.isNaN( value ) ? null : Number( value ),
			} );
		}
	)
	.version( false )
	.option( 'verbose', {
		alias: 'v',
		describe: 'Enable verbose debug output.',
	} )
	.option( 'key', {
		alias: 'k',
		nargs: 1,
		describe: 'Key of existing load to continue.',
	} )
	.option( 'category', {
		nargs: 1,
		default: 'anime/RWBY',
		describe: 'Fanfiction category to scrape.',
	} )
	.option( 'out-dir', {
		nargs: 1,
		default: `.${path.sep}output`,
		parse: path.normalize,
		describe: 'Specify the output directory.',
	} )
	.option( 'dump-html', {
		describe: 'Save the body of all http requests made during the scrape.',
	} )
	.help()
	.argv;


if( argv.verbose ) {
	if( typeof argv.verbose === 'string' ) {
		debug.enable( argv.verbose.split( ',' ).map( ( v ) => `ff:${v}` ).join( ',' ) );
	} else {
		debug.enable( 'ff:*' );
	}
}

const scraper = new FFScraper( {
	uuid: argv.key,
	category: argv.category,
	outDir: argv[ 'out-dir' ],
	dumpHtml: argv[ 'dump-html' ],
} );

scraper.getPages( argv.start, argv.end )
