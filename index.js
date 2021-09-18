const sqlite3 = require("sqlite3");
const express = require('express');
const Math = require("math");
const fs = require("fs");

const DB_TILES = __dirname +"/public/data/vfrsec.mbtiles";
const DB_HISTORY = __dirname + "/public/data/positionhistory.db";

const settings = readSettingsFile();

function readSettingsFile() {
    let rawdata = fs.readFileSync(__dirname + '/settings.json');
    return JSON.parse(rawdata);
}

let mapdb = new sqlite3.Database(DB_TILES, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.log("Failed to load: " + DB_TILES);
        throw err;
    }
});

let histdb = new sqlite3.Database(DB_HISTORY, sqlite3.OPEN_READWRITE, (err) => {
    if (err){
        console.log("Failed to load: " + DB_HISTORY);
    }
});

// express web server  
let app = express();
try {
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json({}));

    app.listen(settings.httpport, () => {
        console.log("Webserver listening at port " + settings.httpport);
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

    app.use(express.static(__dirname + "/public", options));
    
    app.get('/',(req, res) => {
        res.sendFile(__dirname + "/public/index.html");
    });

    app.get("/tiles/tilesets", (req,res) => {
        handleTilesets(req, res);
    });    

    app.get("/tile/vfrsec/*", (req, res) => {
        handleTile(req, res)
    });

    app.get("/history", (req,res) => {
        getPositionHistory(res);
    });

    app.get("/settings", (req, res) => {
        getSettings(res);
    });

    app.post("/updateposition", (req, res) => {
        putPositionHistory(req.body);
        res.writeHead(200);
        res.end();
    });
}
catch (error) {
    console.log(error);
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
    let sql = "INSERT INTO position_history (datetime, longitude, latitude, heading, gpsaltitude) " +
              `VALUES ('${datetime}', ${data.longitude}, ${data.latitude}, ${data.heading}, ${data.altitude})`;
    console.log(sql); 
        
    histdb.run(sql, function(err) {
        if (err != null) {
            console.log(err);
        }
    });
}

function getSettings(response) {
    response.writeHead(200);
    response.write(JSON.stringify(settings));
    response.end();
}

function handleTile(request, response) {
	
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
    loadTile(z, x, y, response); 
}

function loadTile(z, x, y, response) {

    let sql = `SELECT tile_data FROM tiles WHERE zoom_level=${z} AND tile_column=${x} AND tile_row=${y}`;

    console.log(sql);

    mapdb.get(sql, (err, row) => {
        if (err == null) {
            if (row == undefined) {
                response.writeHead(404);
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
    let sql = "SELECT name, value FROM metadata" +
            " UNION SELECT 'minzoom', min(zoom_level) FROM tiles WHERE NOT EXISTS (SELECT * FROM metadata WHERE name='minzoom')" +
            " UNION SELECT 'maxzoom', max(zoom_level) FROM tiles WHERE NOT EXISTS (SELECT * FROM metadata WHERE name='maxzoom')";
    console.log(sql);
    let found = false;
    let meta = {};
    meta["bounds"] = "";

    mapdb.all(sql, [], (err, rows) => {
        rows.forEach(row => {
            // determine extent of layer if not given.. Openlayers kinda needs this, or it can happen that it tries to do
            // a billion request do down-scale high-res pngs that aren't even there (i.e. all 404s)
            if (row.value != null) {
                meta[row.name] = `${row.value}`;
            }
            if (row.name === "maxzoom" && row.value != null && !found) {
                let maxZoomInt = parseInt(row.value); 
                sql = "SELECT min(tile_column) as xmin, min(tile_row) as ymin, " + 
                             "max(tile_column) as xmax, max(tile_row) as ymax FROM tiles WHERE zoom_level=?"
                mapdb.get(sql, [maxZoomInt], (err, row) => {
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
	// osm-like schema:
	y = (1 << z) - y - 1
	
    let n = Math.PI - 2.0*Math.PI*y/Math.pow(2, z);
	
    lat = 180.0 / Math.PI * Math.atan(0.5*(Math.exp(n)-Math.exp(-n)));
	
    lon = x/Math.pow(2, z)*360.0 - 180.0;
	
    return [lon, lat]
}

