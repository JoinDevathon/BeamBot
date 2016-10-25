const BeamClient = require('beam-client-node');
const BeamSocket = require('beam-client-node/lib/ws');

const mysql = require('mysql');
const connection = mysql.createConnection({
    database: 'devathon',
    host: 'localhost',
    user: 'root',
    password: 'root'
});

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

const sockets = {}; // key: beam id, value: BeamSocket

function handleMessage(devathonId, data) {
    console.log('message', data);
}

function joinChannel(id, userId, devId) {
    client.chat.join(id)
        .then(res => {
            console.log(res.body);
            const socket = new BeamSocket(res.body.endpoints).boot();

            socket.on('ChatMessage', data => {
                handleMessage(devId, data);
            });

            socket.on('error', (error) => console.error(error));

            console.log('connecting..');
            return socket.auth(id, userId, res.body.authkey);
        })
        .then(() => {
            console.log('logged in for', devId);
        })
        .catch(err => {
            console.error('error', err);
        });
}

process.on('unhandledRejection', (err) => console.error('Unhandled rejection', err));

function leaveChannel(id) {
    console.log('leaving', id);
}
