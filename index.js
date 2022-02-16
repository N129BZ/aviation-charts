const sqlite3 = require("sqlite3");
const express = require('express');
const Math = require("math");
const fs = require("fs");
const url = require('url');
const XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
const metarurl = "https://www.aviationweather.gov/adds/dataserver_current/httpparam?dataSource=metars&requestType=retrieve&format=xml&hoursBeforeNow=1.5&mostRecentForEachStation=true&stationString=";
const tafurl = "https://www.aviationweather.gov/taf/data?ids=###AIRPORT###&format=decoded&metars=off";
const pirepurl = "https://www.aviationweather.gov/adds/dataserver_current/httpparam?datasource=pireps&requesttype=retrieve&format=xml&hoursBeforeNow=.5";


const settings = readSettingsFile();
function readSettingsFile() {
    let rawdata = fs.readFileSync(`${__dirname}/settings.json`);
    return JSON.parse(rawdata);
}

const DB_PATH        = `${__dirname}/public/data`;
const DB_SECTIONAL   = `${DB_PATH}/${settings.sectionalDb}`;
const DB_TERMINAL    = `${DB_PATH}/${settings.terminalDb}`;
const DB_HELICOPTER  = `${DB_PATH}/${settings.helicopterDb}`;
const DB_CARIBBEAN   = `${DB_PATH}/${settings.caribbeanDb}`;
const DB_GCANYONAO   = `${DB_PATH}/${settings.gcanyonAoDb}`;
const DB_GCANYONGA   = `${DB_PATH}/${settings.gcanyonGaDb}`;
const DB_HISTORY     = `${DB_PATH}/${settings.historyDb}`;
const DB_AIRPORTS    = `${DB_PATH}/${settings.airportsDb}`;

let airpdb = new sqlite3.Database(DB_AIRPORTS, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        conditionalLog(`Failed to load: ${DB_AIRPORTS}`);
        throw err;
    }
});

let airportJson = ""; 
loadAirportsJson();

function loadAirportsJson() {
    let strjson = ""; 
    let sql = `SELECT ident, type, elevation_ft, longitude_deg, latitude_deg FROM airports ` +
                `WHERE (type NOT IN ('heliport','seaplane_base','closed')) AND iso_country = 'US';`;
    airpdb.all(sql, (err, rows) => {
        if (err === null) {
            rows.forEach(row => {
                strjson += `, { "ident": "${row.ident}", "type": "${row.type}", "elevation": ${row.elevation_ft},"lonlat": [${row.longitude_deg}, ${row.latitude_deg}] }`; 
            });
            let newjson = `{ "airports": [ ${strjson.substring(1)} ] }`;
            airportJson = newjson;
        }
    });
}

let vfrdb = new sqlite3.Database(DB_SECTIONAL, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        conditionalLog(`Failed to load: ${DB_SECTIONAL}`);
        throw err;
    }
});

let termdb = new sqlite3.Database(DB_TERMINAL, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        conditionalLog(`Failed to load: ${DB_TERMINAL}`);
        throw err;
    }
});

let helidb = new sqlite3.Database(DB_HELICOPTER, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        conditionalLog(`Failed to load: ${DB_HELICOPTER}`);
        throw err;
    }
});

let caribdb = new sqlite3.Database(DB_CARIBBEAN, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        conditionalLog(`Failed to load: ${DB_CARIBBEAN}`);
        throw err;
    }
});

let gcaodb = new sqlite3.Database(DB_GCANYONAO, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        conditionalLog(`Failed to load: ${DB_GCANYONAO}`);
        throw err;
    }
});

let gcgadb = new sqlite3.Database(DB_GCANYONGA, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        conditionalLog(`Failed to load: ${DB_GCANYONGA}`);
        throw err;
    }
});

let histdb = new sqlite3.Database(DB_HISTORY, sqlite3.OPEN_READWRITE, (err) => {
    if (err){
        conditionalLog(`Failed to load: ${DB_HISTORY}`);
    }
});

// express web server  
let app = express();
try {
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json({}));
    app.use('/img', express.static(`${__dirname}/public/img`));

    app.listen(settings.httpport, () => {
        conditionalLog(`Webserver listening at port ${settings.httpport}`);
    }); 

    var options = {
        dotfiles: 'ignore',
        etag: false,
        extensions: ['html'],
        index: false,
        redirect: false,
        setHeaders: function (res, path, stat) {
            res.set('x-timestamp', Date.now());
        }
    };

    app.use(express.static(`${__dirname}/public`, options));
    
    app.get('/',(req, res) => {
        res.sendFile(`${__dirname}/public/index.html`);
    });
    
    app.get("/getsettings", (req, res) => {
        let rawdata = fs.readFileSync(`${__dirname}/settings.json`);
        res.writeHead(200);
        res.write(rawdata);
        res.end();
    });
    
    app.get("/tiles/tilesets", (req,res) => {
        handleTilesets(req, res);
    });    

    app.get("/tiles/vfrsectile/*", (req, res) => {
        handleTile(req, res, vfrdb);
    });

    app.get("/tiles/termtile/*", (req, res) => {
        handleTile(req, res, termdb);
    });

    app.get("/tiles/helitile/*", (req, res) => {
        handleTile(req, res, helidb);
    });

    app.get("/tiles/caribtile/*", (req, res) => {
        handleTile(req, res, caribdb);
    });

    app.get("/tiles/gcaotile/*", (req, res) => {
        handleTile(req, res, gcaodb);
    });

    app.get("/tiles/gcgatile/*", (req, res) => {
        handleTile(req, res, gcgadb);
    });

    app.get("/gethistory", (req,res) => {
        getPositionHistory(res);
    });

    app.post("/puthistory", (req, res) => {
        putPositionHistory(req.body);
        res.writeHead(200);
        res.end();
    });

    app.get("/getairports", (req, res) => {
        res.writeHead(200);
        res.write(airportJson); 
        res.end();
    });

    app.get("/getmetars/:airportlist", (req, res) => {
        var data = getMetars(req.params.airportlist);
        res.writeHead(200);
        res.write(data); 
        res.end();
    });

    app.get("/gettaf/:airport", (req, res) => {
        var data = getTaf(req.params.airport);
        res.writeHead(200);
        res.write(data); 
        res.end();
    });

    app.get("/getpireps", (req, res) => {
        var data = getPireps();
        res.writeHead(200);
        res.write(data); 
        res.end();
    });
}
catch (error) {
    conditionalLog(error);
}

function getMetars(airportlist) {
    var retval = "";
    var xhr = new XMLHttpRequest();
    let url = `${metarurl}${airportlist}`;
    xhr.open('GET', url, false);
    xhr.responseType = 'xml';
    xhr.onload = () => {
        let status = xhr.status;
        if (status == 200) {
            conditionalLog(xhr.responseText);
            retval = xhr.responseText;
        }
    };
    xhr.send();
    return retval;
}

function getTaf(airport) {
    var retval = "";
    var xhr = new XMLHttpRequest();
    let url = tafurl.replace("###AIRPORT###", airport);
    xhr.open('GET', url, false);
    xhr.responseType = 'xml';
    xhr.onload = () => {
        let status = xhr.status;
        if (status == 200) {
            conditionalLog(xhr.responseText);
            retval = xhr.responseText;
        }
    };
    xhr.send();
    return retval;
}

function getPireps() {
    var retval = "";
    var xhr = new XMLHttpRequest();
    xhr.open('GET', pirepurl, false);
    xhr.responseType = 'xml';
    xhr.onload = () => {
        let status = xhr.status;
        if (status == 200) {
            conditionalLog(xhr.responseText);
            retval = xhr.responseText;
        }
    };
    xhr.send();
    return retval;
}

function getPositionHistory(response) {
    let sql = "SELECT * FROM position_history WHERE id IN ( SELECT max( id ) FROM position_history )";
    histdb.get(sql, (err, row) => {
        if (err == null) {
            if (row != undefined) {
                let obj = {};
                obj["longitude"] = row.longitude;
                obj["latitude"] = row.latitude;
                obj["heading"] = row.heading;
                response.writeHead(200);
                response.write(JSON.stringify(obj));
                response.end();
            }
        }
        else
        {
            response.writeHead(500);
            response.end();
        }
    });
}

function putPositionHistory(data) {
    let datetime = new Date().toISOString();
    let sql = `INSERT INTO position_history (datetime, longitude, latitude, heading, gpsaltitude) ` +
              `VALUES ('${datetime}', ${data.longitude}, ${data.latitude}, ${data.heading}, ${data.altitude})`;
    conditionalLog(sql); 
        
    histdb.run(sql, function(err) {
        if (err != null) {
            conditionalLog(err);
        }
    });
}


function handleTile(request, response, db) {
    let x = 0;
    let y = 0;
    let z = 0;
    let idx = -1;

    let parts = request.url.split("/"); 
	if (parts.length < 4) {
		return
	}

	try {
        idx = parts.length - 1;
        let yparts = parts[idx].split(".");
        y = parseInt(yparts[0])

    } catch(err) {
        res.writeHead(500, "Failed to parse y");
        response.end();
        return;
    }
    
    idx--
    x = parseInt(parts[idx]);
    idx--
    z = parseInt(parts[idx]);
    idx--
    loadTile(z, x, y, response, db); 
}

function loadTile(z, x, y, response, db) {

    let sql = `SELECT tile_data FROM tiles WHERE zoom_level=${z} AND tile_column=${x} AND tile_row=${y}`;
    db.get(sql, (err, row) => {
        if (err == null) {
            if (row == undefined) {
                response.writeHead(200);
                response.end();
            }
            else {
                if (row.tile_data != undefined) {
                    let png = row.tile_data;
                    response.writeHead(200);
                    response.write(png);
                    response.end();
                }
            }
        }
        else {
            response.writeHead(500, err.message);
            response.end();
        } 
    });
}

function handleTilesets(request, response) {
    let sql = `SELECT name, value FROM metadata UNION SELECT 'minzoom', min(zoom_level) FROM tiles ` + 
              `WHERE NOT EXISTS (SELECT * FROM metadata WHERE name='minzoom') UNION SELECT 'maxzoom', max(zoom_level) FROM tiles ` +
              `WHERE NOT EXISTS (SELECT * FROM metadata WHERE name='maxzoom')`;
    let found = false;
    let meta = {};
    meta["bounds"] = "";
    let db = vfrdb;
    let parms = url.parse(request.url,true).query
    switch (parms.layer) {
        case "term":
            db = termdb;
            break;
        case "heli":
            db = helidb;
            break;
        case "carib":
            db = caribdb;
            break;
        case "gcao":
            db = gcaodb;
            break;
        case "gcga":
            db = gcgadb;
            break;
        default:
            break;
    }

    db.all(sql, [], (err, rows) => {
        rows.forEach(row => {
            if (row.value != null) {
                meta[row.name] = `${row.value}`;
            }
            if (row.name === "maxzoom" && row.value != null && !found) {
                let maxZoomInt = parseInt(row.value); 
                sql = `SELECT min(tile_column) as xmin, min(tile_row) as ymin, ` + 
                             `max(tile_column) as xmax, max(tile_row) as ymax ` +
                      `FROM tiles WHERE zoom_level=?`;
                db.get(sql, [maxZoomInt], (err, row) => {
                    let xmin = row.xmin;
                    let ymin = row.ymin; 
                    let xmax = row.xmax; 
                    let ymax = row.ymax;  
                    
                    llmin = tileToDegree(maxZoomInt, xmin, ymin);
                    llmax = tileToDegree(maxZoomInt, xmax+1, ymax+1);
                    
                    retarray = `${llmin[0]}, ${llmin[1]}, ${llmax[0]}, ${llmax[1]}`;
                    meta["bounds"] = retarray;
                    let output = JSON.stringify(meta);
                    found = true;
                    response.writeHead(200);
                    response.write(output);
                    response.end();
                    return;
                });
            }
        });
    });
}

function tileToDegree(z, x, y) {
	y = (1 << z) - y - 1
    let n = Math.PI - 2.0*Math.PI*y/Math.pow(2, z);
    lat = 180.0 / Math.PI * Math.atan(0.5*(Math.exp(n)-Math.exp(-n)));
    lon = x/Math.pow(2, z)*360.0 - 180.0;
    return [lon, lat]
}

function conditionalLog(entry) {
    if (settings.debug) {
        console.log(entry);
    }
}

