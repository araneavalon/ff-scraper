'use strict';

import fs from 'fs-extra';
import path from 'path';
import { execFile } from 'child_process';
import split from 'split2';
import _debug from 'debug';

const debug = _debug( 'ff:export' );


export async function findFiles( ...args ) {
	const files = [];
	await new Promise( ( pass, fail ) => {
		const child = execFile( 'find', args, { maxBuffer: Math.pow( 2, 30 ) } );
		child.on( 'error', ( error ) => fail( error ) );
		child.on( 'exit', ( error, code ) => {
			debug( `Child exit. code=${code} error=${error.message}` );
			pass();
		} );
		child.stdout
			.on( 'error', ( error ) => fail( error ) )
			.pipe( split() )
			.on( 'data', ( file ) => {
				files.push( file );
			} );
	} );
	return Promise.all( files.sort().map( ( file ) => fs.readJSON( file ) ) );
}

export async function getChapters( srcDir, story_id ) {
	debug( `Getting chapters. id=${story_id}` );
	const chapters = await findFiles(
		path.join( srcDir, `story.${story_id}` ),
		'-type', 'f',
		'-name', 'chapter.*.json' );
	debug( `Got chapters. id=${story_id} length=${chapters.length}` );
	return chapters;
}

export async function getStories( srcDir ) {
	debug( 'Getting stories.' );
	const stories = await findFiles( srcDir, '-type', 'f', '-name', 'story.json' );
	debug( `Got stories. length=${stories.length}` );
	return stories;
}

export function formatOutput( file ) {
	return `{${file.map( ( line ) => JSON.stringify( line ) ).join( ',\n' )}]`;
}

export async function exportOutput( key, src, dest ) {
	const srcDir = path.join( src, key ),
		destDir = path.join( dest, key );

	await fs.mkdirp( path.join( destDir, 'chapters' ) );

	const stories = await getStories( srcDir );
	debug( `Got ${stories.length} stories.` );
	await fs.writeFile( path.join( destDir, 'stories.json' ), formatOutput( stories ) );

	for( let i = 0; i < stories.length; ++i ) {
		const story_id = stories[ i ].id;
		debug( `Getting chapters for story ${story_id} ${i + 1}/${stories.length}.` );
		const chapters = await getChapters( srcDir, story_id );
		await fs.writeFile( path.join( destDir, 'chapters', `${story_id}.json` ), formatOutput( chapters ) );
	}
}






