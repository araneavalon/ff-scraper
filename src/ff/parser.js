'use strict';

import cheerio from 'cheerio';


export class FFParser {
	getBaseStory() {
		const story = {
			id: null,
			title: null,
			author: { id: null, username: null },
			summary: null,
			rating: null,
			language: null,
			genres: [],
			characters: [],
			relationships: [],
			words: null,
			reviews: null,
			faves: null,
			follows: null,
			published: null,
			updated: null,
			cached: null,
			complete: false,
			lastChapter: null,
			chapters: [],
			errors: [],
		};
		return new Proxy( story, {
			apply: () => {
				return story;
			},
			set: ( story, key, value ) => {
				if( typeof value !== 'function' ) {
					story[ key ] = value;
					return true;
				}
				try {
					story[ key ] = value( story[ key ] );
				} catch( e ) {
					story.errors.push( `Unable to parse story.${key}: "${e.message}"` );
				}
				return true;
			}
		} );
	}

	isTextNode( node ) {
		return node.nodeType === 3;
	}

	getTextNodes( root, out = [] ) {
		for( let i = 0; i < root.childNodes.length; ++i ) {
			const node = root.childNodes[ i ];
			if( this.isTextNode( node ) ) {
				out.push( node );
			} else {
				this.getTextNodes( node, out );
			}
		}
		return out;
	}

	parsePNode( root ) {
		const textNodes = this.getTextNodes( root );
		const out = [];
		for( const node of textNodes ) {
			const fragment = { b: false, i: false, s: false, u: false, a: 'LEFT', value: node.data };
			let n = node;
			while( ( n = n.parentNode ) ) {
				switch( n.tagName.toLowerCase() ) {
					case 'strong':
						fragment.b = true;
						break;
					case 'em':
						fragment.i = true;
						break;
					case 'span':
						fragment.s = ( n.style && n.style.textDecoration === 'line-through' );
						fragment.u = ( n.style && n.style.textDecoration === 'underline' );
						break;
					case 'p':
						if( n.style && n.style.textAlign === 'center' ) {
							fragment.a = 'CENTER';
						}
						break;
				}
			}

			const f = {};
			for( let key in fragment ) {
				if( key === 'a' && fragment.a !== 'LEFT' ) {
					f.a = fragment.a;
				} else if( key !== 'value' && fragment[ key ] === true ) {
					f[ key ] = fragment[ key ];
				} else if( key === 'value' ) {
					f.value = fragment.value;
				}
			}
			if( Object.keys( f ).length > 1 ) {
				out.push( f );
			} else {
				out.push( f.value );
			}

			if( n === root ) {
				break;
			}
		}

		if( out.length === 1 ) {
			return out[ 0 ];
		} else {
			return out;
		}
	}

	parseLine( line ) {
		switch( line.tagName.toLowerCase() ) {
			case 'p':
				return this.parsePNode( line );
			// TODO deal with OL and UL "lines"
			case 'hr':
				return 'HORIZONTAL_LINE';
			default:
				return 'UNKNOWN';
		}
	}

	parseChapter( html ) {
		const $ = cheerio.load( html );
		return {
			title: $( '#chap_select > option[selected]' ).first().text().trim().replace( /^\d+. /, '' ),
			content: $( '.storytext > p' ).toArray()
				.map( ( line ) => this.parseLine( line ) ),
		};
	}

	parseStory( now, $ ) {
		const story = this.getBaseStory();

		story.cached = now;

		story.id = () => Number( $( '.stitle' ).attr( 'href' ).match( /^\/s\/(\d+)\/1/ )[ 1 ] );
		story.title = () => $( '.stitle' ).text().trim();

		const author = $( 'a[href^="/u/"]' );
		story.author = () => ( { id: Number( author.attr( 'href' ).match( /\/u\/(\d+)/ )[ 1 ] ), username: author.text().trim() } );

		story.summary = () => $( '.z-indent.z-padtop' ).clone().children().remove().end().text().trim();

		const stats = $( '.z-indent.z-padtop > .z-padtop2.xgray' ),
			dates = stats.find( 'span[data-xutime]' );
		story.published = () => Number( $( dates.get( ( dates.length > 1 ) ? 1 : 0 ) ).attr( 'data-xutime' ) );
		story.updated = () => Number( $( dates.get( 0 ) ).attr( 'data-xutime' ) );

		stats.text().trim().split( ' - ' ).forEach( ( s, i, { length: l } ) => {
			const m = s.match( /^(\w+?): (.+?)$/ );
			if( m != null ) {
				const [ , key, value ] = m;
				switch( key ) {
					case 'Rated':
						story.rating = String( value );
						break;
					case 'Chapters':
						story.lastChapter = Number( value.replace( /,/g, '' ) );
						break;
					case 'Words':
						story.words = Number( value.replace( /,/g, '' ) );
						break;
					case 'Reviews':
						story.reviews = Number( value.replace( /,/g, '' ) );
						break;
					case 'Favs':
						story.faves = Number( value.replace( /,/g, '' ) );
						break;
					case 'Follows':
						story.follows = Number( value.replace( /,/g, '' ) );
						break;
				}
			}

			if( s === 'Complete' ) {
				story.complete = true;
			} else if( i === 1 ) {
				story.language = s;
			} else if( i === 2 ) {
				story.genres = s.replace( 'Hurt/Comfort', '_HC_' ).split( '/' ).map( ( genre ) => genre.replace( '_HC_', 'Hurt/Comfort' ) );
			} else if( i === ( l - 1 ) || i === ( l - 2 ) ) {
				story.characters = s
					.split( /[\[\],]/g )
					.map( ( v ) => v.trim() )
					.filter( ( v ) => v )
					.sort();

				const m = s.match( /\[.+?\]/g );
				if( m != null ) {
					story.relationships = m.map( ( v ) =>
						v.split( ',' ).map( ( v ) =>
							v.replace( /[\[\]]/, '' ).trim() ).sort() );
				}
			}
		} );

		return story;
	}

	parsePage( html ) {
		const now = ( +( new Date() ) ) / 1000;
		const $ = cheerio.load( html );
		return $( '.z-list.zhover.zpointer' ).toArray().map( ( e ) =>
			this.parseStory( now, ( s ) => $( e ).find( s ) ) );
	}
}

export const ffParser = new FFParser();
