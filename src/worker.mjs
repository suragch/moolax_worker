// Worker

export default {
	async fetch(request, env, ctx) {
		const { method } = request;

		// Set the CORS headers for the preflight request
		if (method === 'OPTIONS') {
			return new Response(null, {headers: corsHeaders});
		}

		// Handle GET request
		else if (request.method === 'GET') {
			return handleGetRequests(request, env);
		} 

		// Handle other request methods
		else {
			return new Response('Method Not Allowed', { status: 405 });
		}
	},
};

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

let fxCache;
let cacheDate;

async function handleGetRequests(request, env) {
	// authenticate
	const authErrorResponse = await authenticateRequest(request, env);
    if (authErrorResponse) {
        return authErrorResponse;
    }
	
	let headers = {
		'Content-Type': 'application/json',
		...corsHeaders,
	};
     
	// first check the local cache
	if (fxCache && cacheDate && isCacheValid(cacheDate)) {
		console.log('Using worker cache. This is free.');
		return new Response(fxCache, { headers: headers });
	}

	// then check the KV cache
	fxCache = await env.MOOLAX_CACHE_KV.get('fxCache');
    cacheDate = await env.MOOLAX_CACHE_KV.get('cacheDate');
	if (fxCache && cacheDate && isCacheValid(cacheDate)) {
		console.log('Using KV cache. This is cheap.');
		return new Response(fxCache, { headers: headers });
	}

	// then check the Durable Object cache
	let id = env.MOOLAX_DURABLE_OBJECT.idFromName('moolax');
	let durableObject = env.MOOLAX_DURABLE_OBJECT.get(id);
	let resp = await durableObject.fetch(request);
	let values = await resp.json();
	fxCache = values.fxCache;
	cacheDate = values.cacheDate;
	if (fxCache && cacheDate && isCacheValid(cacheDate)) {
		console.log('Using Durable Object cache. This is reliable.');
		saveToKv(fxCache, cacheDate, env);
		return new Response(fxCache, { headers: headers });
	}

	// finally get the value from the third party server
	console.log('contacting fixer.io');
	const fixerUrl = `http://data.fixer.io/api/latest?access_key=${env.FIXER_ACCESS_KEY}`;
    const response = await fetch(fixerUrl);
	if (!response.ok) {
		const responseBody = await response.text();
		console.log(`fixer.io error: ${responseBody}`);
		return new Response(`Third-party server failed with status ${response.status}.`, { status: 500 });
	}
	const data = await response.json();
  	const success = data.success;
    if (!success) {
		return new Response(`Error: ${JSON.stringify(data.error)}`, { status: 500 });
	}
	
	// update cache
	fxCache = JSON.stringify(data);
	cacheDate = Date.now().toString();
	saveToKv(fxCache, cacheDate, env);
	await saveToDurableObject(fxCache, cacheDate, durableObject);

	console.log('updated caches from server. This should happen only once a day max.');
	return new Response(jsonString, { headers: headers });
}

// Not waiting for the save to finish in order to improve response times.
// KV is already only eventually consistent anyway.
function saveToKv(cache, date, env) {
	env.MOOLAX_CACHE_KV.put('fxCache', cache);
	env.MOOLAX_CACHE_KV.put('cacheDate', date);
	// In the future, if we need to halve the number of KV reads and writes,
	// we could combine the two variables into a single json object.
}

async function saveToDurableObject(cache, date, durableObject) {
	await durableObject.fetch(request.url, {
		method: 'PUT',
		body: JSON.stringify({
			'fxCache': cache,
			'cacheDate': date
		}),
	});
}

async function authenticateRequest(request, env) {
    const auth = request.headers.get('Authorization');
  	if (!auth || !auth.startsWith('Bearer ')) {
    	return new Response('Unauthorized', { status: 401 });
  	}
  	const token = auth.slice(7);
  	if (token !== env.CLIENT_API_KEY) {
    	return new Response('Invalid API key', { status: 403 });
  	}
	const url = new URL(request.url);
	if (url.pathname !== '/api') {
		return new Response('Not Found', { status: 404 });
	}
    return null;
}

function isCacheValid(cachedDate) {
	const ONE_DAY = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
	const now = Date.now();
	return (now - cachedDate) < ONE_DAY;
}

// Durable object

export class MoolaxDurableObject {
	constructor(state, env) {
	  this.state = state;
	}
  
	async fetch(request) {
		if (request.method === 'GET') {
			let fxCache = await this.state.storage.get("fxCache");
			let cacheDate = await this.state.storage.get("cacheDate");
			return new Response(JSON.stringify({"fxCache": fxCache, "cacheDate": cacheDate}));
		} else if (request.method === 'PUT') {
			const requestBody = await request.json();
			const cacheDate = requestBody.cacheDate;
			const fxCache = requestBody.fxCache;
			await this.state.storage.put("fxCache", fxCache);
			await this.state.storage.put("cacheDate", cacheDate);
			return new Response(null, { status: 204 });
		} else {
			return new Response(null);
		}
	}
}