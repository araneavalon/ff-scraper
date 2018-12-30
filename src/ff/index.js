'use strict';

import fs from 'fs-extra';
import path from 'path';
import { execFile } from 'child_process';
import split from 'split2';
import _ from 'lodash';
import uuid from 'uuid/v4';

import _debug from 'debug';
const debug_ff = _debug( 'ff:scraper' );
const debug_rq = _debug( 'ff:request' );
const debug_fs = _debug( 'ff:fs' );

import pprint from '../pprint';
import { RequestQueue } from '../queue';
import { ffParser } from './parser';


export class FFScraper {
	constructor( options = {} ) {
		this.queue = new RequestQueue( options.queue );

		this.uuid = ( options.uuid != null ) ? options.uuid : uuid();
		this.category = options.category;

		this.outDir = path.join( ( options.outDir != null ) ? options.outDir : '.', this.uuid );
		this.dumpDir = options.dumpHtml ? path.join( this.outDir, 'http-dump' ) : null;

		this.maxAttempt = ( options.maxAttempts != null ) ? options.maxAttempt : 10;

		this.dirs = {};

		this.attempt = 1;
	}

	getPageUrl( page, { srt = 2 } = {} ) {
		return `https://www.fanfiction.net/${this.category}/?srt=${srt}&r=10&p=${page}`;
	}
	getChapterUrl( story_id, chapter ) {
		return `https://www.fanfiction.net/s/${story_id}/${chapter}`;
	}

	getUrlFile( url ) {
		return `${url.replace( /^https:\/\//, '' ).replace( /\//g, '-' )}.html`;
	}

	getStoryFile( story_id ) {
		return path.join( `story.${story_id}`, 'story.json' );
	}
	getChapterFile( story_id, chapter, v = null ) {
		const number = _.padStart( chapter, 4, '0' );
		if( v != null ) {
			return path.join( `story.${story_id}`, `chapter.${number}.v${v}.json` );
		} else {
			return path.join( `story.${story_id}`, `chapter.${number}.json` );
		}
	}

	async makeDir( file ) {
		const dir = path.dirname( file );
		if( !this.dirs[ dir ] ) {
			this.dirs[ dir ] = Promise.resolve()
				.then( () => debug_fs( `Creating directory. (dir=${dir})` ) )
				.then( () => fs.mkdirp( dir ) )
				.then( () => debug_fs( `Created directory. (dir=${dir})` ) );
		}
		return this.dirs[ dir ];
	}

	async storyExists( story_id ) {
		return fs.exists( path.join( this.outDir, this.getStoryFile( story_id ) ) );
	}
	async chapterExists( story_id, chapter_id ) {
		return fs.exists( path.join( this.outDir, this.getChapterFile( story_id, chapter_id ) ) );
	}

	async dumpResponse( url, _content ) {
		const file = path.join( this.dumpDir, this.getUrlFile( url ) ),
			content = ( typeof _content === 'string' ) ? _content : JSON.stringify( _content );
		await this.makeDir( file );
		debug_fs( `Dumping response to file. (file=${file})` );
		await fs.writeFile( file, content );
		debug_fs( `Finished dumping response to file. (file=${file})` );
	}

	async writeFile( fileName, json ) {
		const file = path.join( this.outDir, fileName ),
			content = JSON.stringify( json, null, 2 ) + '\n';
		await this.makeDir( file );
		debug_fs( `Writing output to file. (file=${file} length=${pprint( content.length )})` );
		await fs.writeFile( file, content );
		debug_fs( `Finished writing output to file. (file=${file} length=${pprint( content.length )})` );
	}

	async rotateChapter( story_id, chapter_id, chapter ) {
		const v = await new Promise( ( pass, fail ) => {
			const child = execFile( 'find', [
				this.getChapterFile( story_id, chapter_id, '*' ),
				'-type', 'f',
				'-name', 'story.json' ] );

			let v = 1;
			child.on( 'error', ( error ) => fail( error ) );
			child.on( 'exit', () => pass( v ) );
			child.stdout
				.pipe( split() )
				.on( 'data', ( file ) => {
					const m = file.match( /\.v(\d+)\.json$/ );
					if( m != null ) {
						v = Math.max( v, Number( m[ 1 ] ) );
					}
				} );
		} );

		const file = path.join( this.outDir, this.getChapterFile( story_id, chapter_id ) ),
			vFile = path.join( this.outDir, this.getChapterFile( story_id, chapter_id, v ) );
		await fs.move( file, vFile );
		await this.writeFile( file, chapter );
	}

	async request( url, priority, attempt = 1 ) {
		debug_rq( `Beginning request. (url=${url} attempt=${attempt})` );
		let response;
		try {
			response = await this.queue.request( { url }, priority );
			this.attempt = 1;
			debug_rq( `Completed request. (url=${url} length=${pprint( response.length )} attempt=${attempt})` );
		} catch( error ) {
			response = error;
			debug_rq( `Errored request. (url=${url} message=${error.message} attempt=${attempt})` );
		}
		if( this.dumpDir != null ) {
			await this.dumpResponse( url, response );
		}
		if( response instanceof Error ) {
			if( this.attempt >= this.maxAttempt ) {
				debug_rq( `Global max attempt reached, throwing. (url=${url})` );
				throw response;
			}
			if( attempt >= 3 ) {
				debug_rq( `Third attempt failed, throwing. (url=${url})` );
				throw response;
			}
			this.attempt += 1;
			debug_rq( `Request failed, re-attempting. (url=${url} attempt=${attempt})` );
			return await this.request( url, priority, attempt + 1 );
		}
		return response;
	}

	async getLastPageNumber() {
		debug_ff( `Getting last page number.` );
		const html = await this.request( this.getPageUrl( 1 ), 1 );
		const lastPage = ffParser.parseLastPageNumber( html );
		debug_ff( `Got last page number. (${lastPage})` );
		return lastPage;
	}

	async getChapter( story_id, chapter_id, skipIfExists = true ) {
		debug_ff( `Getting chapter. (${story_id}/${chapter_id})` );

		const chapterExists = await this.chapterExists( story_id, chapter_id );
		if( skipIfExists && chapterExists ) {
			debug_ff( `Chapter found, skipping. (${story_id}/${chapter_id})` );
			return;
		}

		const html = await this.request( this.getChapterUrl( story_id, chapter_id ), 1 );
		debug_ff( `Got chapter. (${story_id}/${chapter_id} length=${pprint( html.length )})` );
		const chapter = ffParser.parseChapter( html );

		if( chapterExists ) {
			await this.rotateChapter( story_id, chapter_id, chapter );
		}

		await this.writeFile( this.getChapterFile( story_id, chapter_id ), chapter );
	}

	async getChapters( story_id, lastChapter, skipIfExists = true ) {
		debug_ff( `Getting chapters. (${story_id} chapters=${lastChapter})` );
		const promises = [];
		for( let chapter_id = 1; chapter_id <= lastChapter; ++chapter_id ) {
			promises.push( this.getChapter( story_id, chapter_id, skipIfExists ) );
		}
		const chapters = await Promise.all( promises );
		debug_ff( `Got chapters. (${story_id} chapters=${chapters.length})` );
	}

	async getPage( page ) {
		debug_ff( `Getting page. (${page})` );
		const html = await this.request( this.getPageUrl( page ) );
		debug_ff( `Got page. (${page} length=${pprint( html.length )})` );
		const stories = ffParser.parsePage( html );
		debug_ff( `Parsed stories. (stories=${stories.length} chapters=${stories.reduce( ( sum, { lastChapter } ) => sum + lastChapter, 0 )})`)
		const promises = [];
		for( const story of stories ) {
			promises.push( this.writeFile( this.getStoryFile( story.id ), story ) );
		}
		await Promise.all( promises );
	}

	async getPages( firstPage = 1, _lastPage = null ) {
		const lastPage = ( _lastPage == null ) ? await this.getLastPageNumber() : _lastPage;
		if( firstPage > lastPage ) {
			throw new Error( `firstPage=${firstPage} must not be greater than lastPage=${lastPage}` );
		}

		debug_ff( `Getting pages. [${firstPage}, ${lastPage}]` );
		const promises = [];
		for( let page = lastPage; page >= firstPage; --page ) {
			promises.push( this.getPage( page ) );
		}
		await Promise.all( promises );
		debug_ff( `Got pages. [${firstPage}, ${lastPage}]` );
	}

	async getExistingStories() {
		debug_ff( `Getting existing stories.` );
		if( !await fs.exists( this.outDir ) ) {
			debug_ff( `No existing stories found.` );
			return [];
		}

		const promises = [];
		await new Promise( ( pass, fail ) => {
			const child = execFile( 'find', [ this.outDir, '-type', 'f', '-name', 'story.json' ], { maxBuffer: Math.pow( 2, 30 ) } );
			child.on( 'error', ( error ) => fail( error ) );
			child.on( 'exit', () => pass() );
			child.stdout
				.pipe( split() )
				.on( 'data', ( file ) => promises.push( fs.readJSON( file ) ) );
		} );
		debug_ff( `Loading existing stories. (stories=${promises.length})` );
		return Promise.all( promises );
	}

	async getChaptersFromExisting() {
		const stories = await this.getExistingStories(),	
			chapters = stories.reduce( ( sum, { lastChapter } ) => sum + lastChapter, 0 );
		debug_ff( `Getting chapters from existing stories. (stories=${stories.length} chapters=${chapters})` );
		const promises = [];
		for( const { id, lastChapter } of stories ) {
			promises.push( this.getChapters( id, lastChapter ) );
		}
		await Promise.all( promises );
		debug_ff( `Got chapters from existing stories. (stories=${stories.length} chapters=${chapters})` );
	}

	async updateStory( story ) {
		if( !await this.storyExists( story.id ) ) {
			debug_ff( `Story does not exist, downloading. (${story.id})` );
			await Promise.all( [
				this.writeFile( this.getStoryFile( story.id ), story ),
				this.getChapters( story.id, story.lastChapter ),
			] );
			return true;
		}

		const oldStory = await fs.readJSON( path.join( this.outDir, this.getStoryFile( story.id ) ) );
		if( story.updated === oldStory.updated && story.words === oldStory.words ) {
			debug_ff( `Story was not updated, ignoring chapters. (${story.id})` );
			await this.writeFile( this.getStoryFile( story.id ), story );
			return false;
		}

		debug_ff( `Updating story. (${story.id} forceChapters=${story.lastChapter !== oldStory.lastChapter})` );
		await Promise.all( [
			this.writeFile( this.getStoryFile( story.id ), story ),
			this.getChapters( story.id, story.lastChapter, story.lastChapter !== oldStory.lastChapter ),
		] );
		return true;
	}

	async getUpdatedPage( page ) {
		debug_ff( `Getting update page. (${page})` );
		const html = await this.request( this.getPageUrl( page, { srt: 1 } ) );
		debug_ff( `Got update page. (${page} length=${pprint( html.length )})` );
		const stories = ffParser.parsePage( html );
		debug_ff( `Parsed updated stories. (stories=${stories.length} chapters=${stories.reduce( ( sum, { lastChapter } ) => sum + lastChapter, 0 )})`)
		const promises = [];
		for( const story of stories ) {
			promises.push( this.updateStory( story ) );
		}
		const updated = await Promise.all( promises );
		return !updated.every( ( v ) => !v );
	}

	async updateExisting() {
		const lastPage = await this.getLastPageNumber();
		debug_ff( `Updating pages. (lastPage=${lastPage})` );
		let end = false;
		for( let page = 1; page <= lastPage; ++page ) {
			const updated = await this.getUpdatedPage( page );
			if( !updated && end ) {
				debug_ff( `Finished updating, for real. (pages=${page})` );
				return;
			} else if( !updated ) {
				debug_ff( `Finished updating, doing one more page. (pages=${page})` );
				end = true;
			} else if( end ) {
				debug_ff( `Whoops, not actually finished updating. (pages=${page})` );
				end = false;
			}
		}
		debug_ff( `Finished updating. (pages=${lastPage})` );
	}
}
