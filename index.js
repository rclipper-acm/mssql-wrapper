'use strict';

var mssql = require('mssql'),
    path = require('path'),
    async = require('async'),
    _ = require('lodash'),
    pools = {},
    dbs = [];

// Create the connection pools
exports.prepareService = function (dbConfig, callback) {
    if (!dbConfig) {
        if(callback) callback();
        return;
    }
    Object.keys(dbConfig).forEach(function (db) {
        dbs[db] = dbConfig[db];
    });
    if(callback) callback();
};

//execute simple query
function executeFlatQuery(options, cb) {
    var dbconn = dbs[options.db],
        qry = options.qry,
        server = options.server;

    if (server) {
        dbconn.server = server;
    }

    mssql.connect(dbconn, function (err) {
        if (err) {
            return cb(err, null);
        };

        var request = new mssql.Request();
        request.stream = true;
        request.query(qry);

        request.on('error', function (err) {
            console.log(err);
            return cb(err);
        });

        cb(null, request);
    });
}

//<summary>Execute prepared statement<summary>
//<param name="options" type="Object">
//Requires db, qrydata, input, params
//</param>
//<returns type="Object">
//Returns query result in object
//</returns>
function executePSQuery(options, cb) {
    var dbconn = dbs[options.db],
        server = options.server || null,
        qry = buildQuery(options.qrydata),
        input = options.input ? options.input : null,
        params = options.params ? options.params : null;

    if (server) {
        dbconn.server = server;
    }

    mssql.connect(dbconn, function (err) {
        if (err) {
            mssql.close();
            return cb(err, null);
        };

        var ps = new mssql.PreparedStatement();

        if (input) {
            input.forEach(function (i) {
                ps.input(i.name, i.type);
            });
        };

        ps.prepare(qry, function (err) {
            if (err) {
                mssql.close();
                return cb(err);
            };

            ps.execute(params, function (err, recordSet, returnValue) {
                ps.unprepare(function (err) {
                    mssql.close();
                    if (err) {
                        return cb(err);
                    };
                    cb(null, recordSet);
                });
            });
        });
    });
};

exports.executePSQuery = executePSQuery;

exports.executeSP = function (options, cb) {
    var dbconn = dbs[options.db],
        procedure = options.procedure,
        input = options.input ? options.input : null,
        output = options.output ? options.output : null;

    mssql.connect(dbconn, function (err) {
        if (err) {
            mssql.close();
            return cb(err, null);
        };

        var sp = new mssql.Request();

        input.forEach(function (i) {
            sp.input(i.name, i.type, i.val);
        });

        if (output) {
            output.forEach(function (i) {
                sp.output(i.name, i.type);
            });
        }

        sp.execute(procedure, (err, result) => {
            mssql.close();
            if (err) {
                return cb(err);
            };
            console.log(result.output)
            cb(null, result.output);
        });
    });
};

//call basic query
function executeQuery(options, cb) {
    var db = options.db,
        qrydata = options.qrydata,
        server = options.server || null,
        outFormat = options.outFormat || null;
    async.waterfall([
            function (callback) {
                executeFlatQuery({
                    db: db,
                    server: server,
                    qry: buildQuery(qrydata)
                }, function (err, request) {
                    if (err) {
                        return callback(err);
                    };
                    return callback(null, request);
                });
            },
            function (request, callback) {
                var response = {
                    result: new Array(300000),
                    recordSet: new Array()
                };
                var ind = 0;
                request.on('error', function (err) {
                    return callback(err, {});
                });

                request.on('row', function (data) {
                    return response.result[ind++] = data;
                });

                request.on('recordset', function (data) {
                    if (outFormat === 'array') {
                        return response.recordSet = data;
                    } else {
                        return;
                    };
                });

                request.on('done', function () {
                    response.result.length = ind;
                    return callback(null, response);
                });
            }
        ],
        function (err, result) {
            mssql.close();
            if (err) {
                return cb(err);
            };
            return cb(null, result);
        }
    );
}

exports.executeQuery = executeQuery;

//build query from supplied qry data
function buildQuery(qrydata) {
    var qry,
        union = false,
        length,
        ndx = 1;
    if (qrydata.length > 1) {
        union = true;
        length = qrydata.length;
    };
    _.forEach(qrydata, function (arg) {
        if (ndx === 1) {
            qry = 'select ' + arg.fields +
                ' from ' + arg.from_objects +
                _.join(arg.join_condition, ' ') +
                (arg.where_clause ? ' where ' + arg.where_clause : '') +
                (arg.group_by ? ' group by ' + arg.group_by : '') +
                (arg.order_by ? ' order by ' + arg.order_by : '');
        } else {
            qry += 'select ' + arg.fields +
                ' from ' + arg.from_objects +
                _.join(arg.join_condition, ' ') +
                (arg.where_clause ? ' where ' + arg.where_clause : '') +
                (arg.group_by ? ' group by ' + arg.group_by : '') +
                (arg.order_by ? ' order by ' + arg.order_by : '');
        }
        if (union && ndx != length) {
            qry += ' union all ';
        };
        ndx++;
    })
    return qry;
}
