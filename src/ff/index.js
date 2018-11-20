'use strict';

/**
 * enum Rating { K = 'K', KP = 'K+', T = 'T', M = 'M' }
 * interface Story {
 *   id: number,
 *   title: string,
 *   author: {
 *     id: number,
 *     username: string,
 *   },
 *   summary: string,
 *   rating: Rating,
 *   language: string,
 *   genres: Array<string>,
 *   characters: Array<string>,
 *   relationships: Array<Array<string>>,
 *   words: number,
 *   reviews: number,
 *   faves: number,
 *   follows: number,
 *   published: number,
 *   updated: number,
 *   cached: number,
 *   complete: boolean,
 *   lastChapter: number,
 *   chapters: Array<Chapter>,
 * }
 *
 * enum Align { Left = 'LEFT', Center = 'CENTER', Right = 'RIGHT' }
 * interface Fragment {
 *   b: boolean,
 *   i: boolean,
 *   s: boolean,
 *   u: boolean,
 *   a: Align,
 *   value: string,
 * }
 * enum NonTextLine {
 *   Unknown = 'UNKNOWN',
 *   HorizontalLine = 'HORIZONTAL_LINE',
 * }
 * interface Chapter {
 *   title?: string,
 *   content: Array<Array<Fragment>|NonTextLine>,
 * }
 */

import fs from 'fs-extra';
import path from 'path';
import _ from 'lodash';
import uuid from 'uuid/v4';

import _debug from 'debug';
const debug_ff = _debug( 'ff:scraper' );
const debug_rq = _debug( 'ff:request' );
const debug_fs = _debug( 'ff:fs' );

import { RequestQueue } from '../queue';
import { ffParser } from './parser';


export class FFScraper {
	constructor( options = {} ) {
		this.queue = new RequestQueue( options.queue );

		this.uuid = ( options.uuid != null ) ? options.uuid : uuid();
		this.category = options.category;

		this.outDir = path.join( ( options.outDir != null ) ? options.outDir : '.', this.uuid );
		this.dumpDir = options.dumpHtml ? path.join( this.outDir, 'http-dump' ) : null;

		this.dirs = {};
	}

	getPageUrl( page ) {
		return `https://www.fanfiction.net/${this.category}/?srt=2&r=10&p=${page}`;
	}
	getChapterUrl( story_id, chapter ) {
		return `https://www.fanfiction.net/s/${story_id}/${chapter}`;
	}

	getUrlFile( url ) {
		return `${url.replace( /^https:\/\//, '' ).replace( /\//g, '-' )}.html`;
	}

	getPageFile( page ) {
		return `page.${_.padStart( page, 4, '0' )}.json`;
	}
	getStoryFile( story_id ) {
		return path.join( `story.${story_id}`, 'story.json' );
	}
	getChapterFile( story_id, chapter ) {
		return path.join( `story.${story_id}`, `chapter.${_.padStart( chapter, 4, '0' )}.json` );
	}

	async makeDir( file ) {
		const dir = path.dirname( file );
		if( !this.dirs[ dir ] ) {
			this.dirs[ dir ] = Promise.resolve()
				.then( () => debug_fs( `Creating directory. (dir=${dir})` ) )
				.then( () => fs.mkdirp( dir ) )
				.then( () => debug_fs( `Created directory. (dir=${dir})` ) );
		}
		return await this.dirs[ dir ];
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
		debug_fs( `Writing output to file. (file=${file} length=${content.length})` );
		await fs.writeFile( file, content );
		debug_fs( `Finished writing output to file. (file=${file} length=${content.length})` );
	}

	async request( url ) {
		debug_rq( `Beginning request. (url=${url})` );
		let response;
		try {
			response = await this.queue.request( { url } );
			debug_rq( `Completed request. (url=${url} length=${response.length})` );
		} catch( error ) {
			response = error;
			debug_rq( `Errored request. (url=${url} message=${error.message})` );
		}
		if( this.dumpDir != null ) {
			await this.dumpResponse( url, response );
		}
		if( response instanceof Error ) {
			throw response;
		}
		return response;
	}

	async getLastPageNumber() {

	}

	async getChapter( story_id, chapter_id ) {
		debug_ff( `Getting chapter. (${story_id}/${chapter_id})` );
		const html = await this.request( this.getChapterUrl( story_id, chapter_id ) );
		debug_ff( `Got chapter. (${story_id}/${chapter_id} length=${html.length})` );
		const chapter = ffParser.parseChapter( html );
		await this.writeFile( this.getChapterFile( story_id, chapter_id ), chapter );
	}

	async getChapters( story_id, lastChapter ) {
		debug_ff( `Getting chapters. (${story_id} chapters=${lastChapter})` );
		const promises = [];
		for( let chapter_id = 1; chapter_id <= lastChapter; ++chapter_id ) {
			promises.push( this.getChapter( story_id, chapter_id ) );
		}
		const chapters = await Promise.all( promises );
		debug_ff( `Got chapters. (${story_id} chapters=${chapters.length})` );
	}

	async getPage( page ) {
		debug_ff( `Getting page. (${page})` );
		const html = await this.request( this.getPageUrl( page ) );
		debug_ff( `Got page. (${page} length=${html.length})` );
		const stories = ffParser.parsePage( html );
		debug_ff( `Parsed stories. (stories=${stories.length} chapters=${stories.reduce( ( sum, { lastChapter } ) => sum + lastChapter, 0 )})`)
		const promises = [];
		for( const story of stories ) {
			promises.push( this.getChapters( story.id, story.lastChapter ) );
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
}
