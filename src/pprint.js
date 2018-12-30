'use strict';

const UNITS = [
	[ 'T', Math.pow( 2, 40 ) ],
	[ 'G', Math.pow( 2, 30 ) ],
	[ 'M', Math.pow( 2, 20 ) ],
	[ 'K', Math.pow( 2, 10 ) ],
];

export default function pprint( n ) {
	for( const [ l, f ] of UNITS ) {
		if( n > f ) {
			return `${Math.round( n / f )}${l}`;
		}
	}
	return String( n );
}
