'use strict';

import fs from 'fs';

import { RequestQueue } from './queue';
import { FFNet } from './ff';


const ff = new FFNet();

ff.getPages( 1 )
	.then( ( pages ) =>
		new Promise( ( pass, fail ) =>
			fs.writeFile( './out.json', JSON.stringify( pages ), ( error ) =>
				error ? fail( error ) : pass() ) ) )
	.catch( ( error ) => console.error( error ) );
