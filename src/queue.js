'use strict';

import _ from 'lodash';
import request from 'request-promise-native';

import _debug from 'debug';
const debug = _debug( 'ff:queue' );


export class RequestQueue {
	constructor( options = {} ) {
		this.options = ( options.request != null ) ? options.request : {};

		this.maxDelay = ( options.maxDelay != null ) ? options.maxDelay : 5000;
		this.minDelay = ( options.minDelay != null ) ? options.minDelay : 2500;
		if( this.minDelay > this.maxDelay ) {
			throw new Error( 'minDelay must not be larger than maxDelay.' );
		}

		this.queue = [];
		this.draining = false;
	}

	delay() {
		return new Promise( ( pass ) => {
			const delay = Math.trunc( Math.random() * ( this.maxDelay - this.minDelay ) ) + this.minDelay;
			debug( `Beginning delay. (${delay/1000}s)` );
			setTimeout( () => pass(), delay );
		} );
	}

	async drain() {
		if( this.draining ) {
			return;
		}
		this.draining = true;

		while( this.queue.length > 0 ) {
			const [ options, pass, fail ] = this.queue.shift();
			await this.delay()
				.then( () => debug( `Request begun. (queue=${this.queue.length} url=${options.url})` ) )
				.then( () => request( options ) )
				.then( ( response ) => pass( response ) )
				.catch( ( error ) => fail( error ) )
				.then( () => debug( `Request finished. (queue=${this.queue.length} url=${options.url})` ) );
		}

		this.draining = false;
	}

	request( _options, priority = 0 ) {
		return new Promise( ( pass, fail ) => {
			const options = _.merge( {}, this.requestOptions, _options );
			debug( `Adding request. (${options.url})` );
			if( priority === 0 ) {
				this.queue.push( [ options, pass, fail ] );
			} else {
				this.queue.unshift( [ options, pass, fail ] );
			}
			this.drain();
		} );
	}
}
