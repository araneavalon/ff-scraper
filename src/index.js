'use strict';

import fs from 'fs';

import { RequestQueue } from './queue';
import { FFNet } from './ff';


const queue = new RequestQueue( {
	logAll: true,
} );
const ff = new FFNet( queue );

ff.getPages( 1 )
	.then( ( pages ) =>
		new Promise( ( pass, fail ) =>
			fs.writeFile( './out.json', JSON.stringify( pages ), ( error ) =>
				error ? fail( error ) : pass() ) ) )
	.catch( ( error ) => console.error( error ) );
