const BeamClient = require('beam-client-node');
const BeamSocket = require('beam-client-node/lib/ws');

const mysql = require('mysql');
const connection = mysql.createConnection({
    database: 'devathon',
    host: 'localhost',
    user: 'root',
    password: 'root'
});

const http = require('http');
const querystring = require('querystring');

http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://restful.link');
    res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    const buffers = [];

    req.on('data', data => {
        buffers.push(data);
    });
    req.on('end', () => {
        const buffer = Buffer.concat(buffers);
        if (buffer.length === 0) {
            return res.end('Bad length');
        }
        const parsed = querystring.unescape(buffer.toString('utf8'));
        let content;
        if (parsed.charAt(0) === '{') {
            content = JSON.parse(parsed);
        } else {
            content = querystring.parse(parsed);
        }

        if (!content.commits) {
            console.log('bad', content);
            return res.end('Not commits');
        }

        const messages = content.commits.map(commit => commit.message + ` (${commit.url})`);
        const message = `${content.pusher.name} pushed commits: ${messages.join(', ')}`;

        connection.query('SELECT `id` FROM `users` WHERE `username` = ?', [content.pusher.name], (err, rows) => {
            if (err) {
                return console.error(err);
            }
            if (rows.length > 0) {
                const {id} = rows[0];
                if (sockets[id]) {
                    sockets[id].call('msg', [message]);
                }
            }
        });
        console.log(message);

        res.end(JSON.stringify({
            hello: 'world'
        }));
    });
    req.on('error', err => console.warn('Got error', err));
}).listen(4000);

connection.connect(err => {
    if (err) {
        return console.error(err);
    }
    connectBeam();
});

let userInfo;

const client = new BeamClient();

function connectBeam() {
    client.use('password', {
        username: 'Devathon',
        password: '85d2120e-d2c2-489f-ac80-9e10b91973f6'
    })
        .attempt()
        .then(response => {
            userInfo = response.body;
            console.log('Connected to beam.');
            updateNames();
            setInterval(updateNames, 1000 * 15); // update names every 15s
        })
        .catch(err => console.error(err.message.body))
}

let channelsIn = [];

function updateNames() {
    connection.query('SELECT `beam`,`id` FROM `users` WHERE `beam` <> \'\'', (err, rows) => {
        if (err) {
            return console.error(err);
        }
        let names = rows.map(row => {
            return {
                name: row.beam,
                id: row.id
            };
        });
        const beamToDevId = {};
        names.forEach(({name, id}) => beamToDevId[name] = id);

        const allArrays = [];
        while (names.length > 0) {
            allArrays.push(names.splice(0, 50));
        }
        const requests = allArrays.map(names => {
            let query = '?where=username:in:' + names.map(name => name.name).join(';') + '&fields=channel,username,id';
            return client.request('GET', '/users/search' + query);
        });

        Promise.all(requests)
            .then(arrays => {
                const mapped = arrays.map(array => array.body).reduce((prev, current) => prev.concat(current), []);
                const justIds = mapped.map(({channel}) => channel.id);

                let length = channelsIn.length;
                while (length--) {
                    const value = channelsIn[length];
                    if (justIds.indexOf(value) < 0) {
                        leaveChannel(value);
                        channelsIn.splice(length, length);
                    }
                }

                for (let prop in mapped) {
                    if (mapped.hasOwnProperty(prop)) {
                        const {channel, username, id} = mapped[prop];
                        if (!beamToDevId[username]) {
                            console.warn('Could not find dev id for', username, beamToDevId);
                            continue;
                        }
                        if (channelsIn.indexOf(channel.id) < 0) {
                            channelsIn.push(channel.id);
                            joinChannel(channel.id, id, beamToDevId[username]);
                        }
                    }
                }
            })
            .catch(err => console.error(err));
    });
}

const sockets = {}; // key: dev id, value: BeamSocket

function handleMessage(devathonId, data, socket) {
    const {message} = data.message;
    if (message && message.length > 0) {
        const first = message[0];
        if (first.type === 'text' && first.text.charAt(0) === '!') {
            const split = first.text.slice(1).trim().split(" ");
            const command = split[0].toLowerCase();
            const args = split.slice(1);

            // todo maybe put this code somewhere else?
            switch (command) {
                case 'repo':
                    connection.query('SELECT `username` FROM `users` WHERE `id` = ?', [devathonId], (err, results) => {
                        if (err) {
                            console.error(err);
                            return socket.call('msg', ['An error occurred looking up the repo!']);
                        }
                        if (results.length === 0) {
                            return socket.call('msg', ['Could not find user with id, internal error.']);
                        }
                        const url = `https://github.com/JoinDevathon/${results[0].username}`;
                        return socket.call('msg', [`You can find the repository at ${url}`]);
                    });
                    break;
            }
        }
    }
}

function joinChannel(id, userId, devId) {
    client.chat.join(id)
        .then(res => {
            const socket = new BeamSocket(res.body.endpoints).boot();

            socket.on('ChatMessage', data => {
                handleMessage(devId, data, socket);
            });

            socket.on('error', (error) => console.error(error));
            sockets[devId] = socket;

            return socket.auth(id, userInfo.id, res.body.authkey);
        })
        .then(() => {
            console.log('logged in for', devId);
        })
        .catch(err => {
            delete sockets[devId];
            console.error('error', err);
        });
}

process.on('unhandledRejection', (err) => console.error('Unhandled rejection', err));

function leaveChannel(id) {
    console.log('leaving', id);
}
