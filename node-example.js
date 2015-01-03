var Looker = require('./looker');

var looker = new Looker({
    token: [API_TOKEN],
    secret: [API_SECRET],
    host: 'example.looker.com'
});
var query = looker
    .query('faa', 'airports')
    .fields('airports.city', 'airports.state')
    .filters({ state: 'GA' });

query.execute()
    .then(function(response, status) {
        console.log(response);
        console.log(status);
    })
    .catch(function(error) {
        console.error(error);
    });
