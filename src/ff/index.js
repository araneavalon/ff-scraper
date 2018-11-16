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
import moment from 'moment';

import _debug from 'debug';
const debug_ff = _debug( 'scraper:ff' );
const debug_rq = _debug( 'scraper:request' );
const debug_fs = _debug( 'scraper:fs' );

import { RequestQueue } from '../queue';
import { ffParser } from './parser';


export class FFNet {
	constructor( options = {} ) {
		this.queue = new RequestQueue( options.queue );

		this.outDir = ( options.outDir != null ) ? options.outDir : path.join( '.', 'output' );
		this.dumpDir = ( options.dumpDir != null ) ? options.dumpDir : null;

		this.dirs = {};
	}

	getPageUrl( page ) {
		return `https://www.fanfiction.net/anime/RWBY/?srt=2&r=10&p=${page}`;
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
				.then( () => fs.makedirp( dir ) )
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

	/**
	 * Get the number of the last page of available results.
	 * @return {Promise<number>} The the page number of the last page of results.
	 */
	async getLastPageNumber() {

	}

	/**
	 * Get a story chapter.
	 * @param {number} story The story id of the current fic.
	 * @param {number} chapter The (1-indexed) chapter number to request.
	 * @return {Promise<Chapter>} The parsed chapter for this page.
	 */
	async getChapter( story, chapter ) {
		debug_ff( `Getting chapter. (${story}/${chapter})` );
		const html = await this.request( this.getChapterUrl( story, chapter ) );
		debug_ff( `Got chapter. (${story}/${chapter} length=${html.length})` );
		return ffParser.parseChapter( html );
	}

	/**
	 * Get and parse a full page of story headers.
	 * @param {number} page The page number to request.
	 * @return {Promise<Array<number>>} The story_ids for this page.
	 */
	async getPage( page ) {
		debug_ff( `Getting page. (${page})` );
		const html = await this.request( this.url.page( page ) );
		debug_ff( `Got page. (${page} length=${html.length})` );
		const stories = ffParser.parsePage( html );
		debug_ff( `Parsed stories. (stories=${stories.length} chapters=${stories.reduce( ( sum, { lastChapter } ) => sum + lastChapter, 0 )})`)
		for( const story of stories ) {
			debug_ff( `Getting chapters. (${story.id} lastChapter=${story.lastChapter})` );
			for( let chapter = 1; chapter <= story.lastChapter; ++chapter ) {
				story.chapters.push( await this.getChapter( story.id, chapter ) );
			}
			debug_ff( `Got chapters. (${story.id} lastChapter=${story.lastChapter})` );
		}
		return stories;
	}

	/**
	 * Get and parse a set of pages. Gets pages in reverse order, last page, to first page.
	 * Stories are in the normal order.
	 * @param {number} [options.firstPage=1] The first (1-indexed) page of results to retrieve.
	 * @param {number} [options.lastPage=this.getLastPageNumber()] The last (1-indexed) page of results to retrieve.
	 * @return {Promise<Array<number>>} An array of story_ids from the pages.
	 */
	async getPages( options = {} ) {
		options.lastPage = ( options.lastPage != null ) ? options.lastPage : await this.getLastPageNumber();
		options.firstPage = ( options.firstPage != null ) ? options.firstPage : 1;
		if( options.firstPage > options.lastPage ) {
			throw new Error( `firstPage=${options.firstPage} must not be greater than lastPage=${options.lastPage}` );
		}

		debug_ff( `Getting pages. [${options.firstPage}, ${options.lastPage}]` );
		const promises = [];
		for( let page = options.lastPage; page >= options.firstPage; --page ) {
			promises.unshift( this.getPage( page ) );
		}
		const stories = _.flatten( await Promise.all( promises ) );
		debug_ff( `Got pages. [${options.firstPage}, ${options.lastPage}] (length=${stories.length})` );
		return stories;
	}
}
