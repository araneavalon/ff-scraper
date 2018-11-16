'use strict';

import _ from 'lodash';
import request from 'request-promise-native';

import _debug from 'debug';
const debug = _debug( 'queue' );


export class RequestQueue {
	constructor( options = {} ) {
		this.options = ( options.request != null ) ? options.request : {};

		this.maxDelay = ( options.maxDelay != null ) ? options.maxDelay : 5000;
		this.minDelay = ( options.minDelay != null ) ? options.minDelay : 2500;
		if( this.minDelay > this.maxDelay ) {
			throw new Error( 'minDelay must not be larger than maxDelay.' );
		}

		this.queue = Promise.resolve();
	}

	delay() {
		return new Promise( ( pass ) => {
			const delay = Math.trunc( Math.random() * ( this.maxDelay - this.minDelay ) ) + this.minDelay;
			debug( `Beginning delay. (${delay/1000}s)` );
			setTimeout( () => pass(), delay );
		} );
	}

	request( _options ) {
		const options = _.merge( {}, this.requestOptions, _options );
		debug( `Adding request. (${options.url})` );
		const out = this.queue
			.then( () => this.delay() )
			.then( () => request( options ) );
		// Do not fail all requests if this one fails, but do fail this request if it fails.
		this.queue = out
			.catch( () => {} )
			.then( () => debug( `Request finished. (${options.url})` ) );
		return out;
	}
}
