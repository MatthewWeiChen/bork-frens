require('dotenv/config');
const express = require('express');
const db = require('./database');
const ClientError = require('./client-error');
const staticMiddleware = require('./static-middleware');
const sessionMiddleware = require('./session-middleware');

const app = express();

app.use(staticMiddleware);
app.use(sessionMiddleware);

app.use(express.json());

app.get('/api/messages/users/:senderId', (req, res, next) => {
  const sender = parseInt(req.params.senderId, 10);
  const messages = (sender <= 7 ? 30 : 31);

  const sql = `
  select "dogName",
  "messageContent",
  "recipientId",
  "senderId",
  "imageUrl",
  "sentAt",
  "messageId",
  "userId"
  from "users"
  JOIN "messages" ON "users"."userId" = "messages"."senderId"
  where "messageId" <= $1
  `;

  const params = [messages];

  db.query(sql, params)
    .then(result => res.status(200).json(result.rows))
    .catch(err => next(err));

});

app.get('/api/messages', (req, res, next) => {
  const sql = `
  select *
  from "messages"
  `;

  db.query(sql)
    .then(result => res.json(result.rows))
    .catch(err => next(err));
});

app.get('/api/conversation/:recipientId', (req, res, next) => {
  const currentUserConvo = parseInt(req.params.recipientId, 10);

  const sql = `
  SELECT "messageContent",
  "dogName",
  "imageUrl",
  "userId",
  "sentAt"
  FROM "users"
  JOIN "messages" ON "users"."userId" = "messages"."senderId"
  where "recipientId" = $1
  `;

  const params = [currentUserConvo];

  return db.query(sql, params)
    .then(result =>
      res.status(200).json(result.rows))
    .catch(err => next(err));
});

app.post('/api/messages', (req, res, next) => {
  const sender = req.body.senderId;
  const recipient = req.body.recipientId;
  const message = req.body.messageContent;

  const sql = `
  insert into "messages" ("recipientId","senderId", "messageContent", "sentAt")
  values($1, $2, $3, $4)
  returning "messageId"
  `;

  const params = [recipient, sender, message, new Date()];

  return db.query(sql, params)
    .then(result => {
      const sql = `
        select "dogName",
        "messageContent",
        "recipientId",
        "senderId",
        "imageUrl",
        "sentAt",
        "messageId"
        from "users"
        JOIN "messages" ON "users"."userId" = "messages"."senderId"
        where "messageId" = $1
      `;
      const params = [result.rows[0].messageId];
      return db.query(sql, params)
        .then(result => {
          res.status(201).json(result.rows);
        });
    })
    .catch(err => next(err));
});

// User can see list of connection requests

app.get('/api/fren-requests/:recipientId', (req, res, next) => {
  const recipientId = parseInt(req.params.recipientId, 10);

  if (recipientId < 0 || isNaN(recipientId)) {
    throw (new ClientError(`Recipient ID ${req.params.recipientId} is not valid`, 400));
  }

  const sql = `
    select "u"."dogName" as "requesterName",
          "u"."imageUrl" as "requesterImage",
          "fr"."requestId",
          "fr"."isAccepted"
      from "frenRequests" as "fr"
      join "users" as "u" on "u"."userId" = "fr"."senderId"
    where "fr"."recipientId" = $1 and
          "fr"."isAccepted" = false;
  `;

  const params = [recipientId];

  db.query(sql, params)
    .then(result => {
      if (result.rows.length === 0) {
        next(new ClientError(`Recipient Id ${recipientId} returned no requests`, 404));
      } else {
        return res.status(200).json(result.rows);
      }
    })
    .catch(error => next(error));
});

// User can see other's profile

app.get('/api/others-profile/:userId', (req, res, next) => {
  const userId = parseInt(req.params.userId, 10);

  if (userId < 0 || isNaN(userId)) {
    throw (new ClientError(`User Id ${req.params.userId} is not valid`, 400));
  }

  const sql = `
    select "u"."userId",
          "u"."dogName",
          "u"."location",
          "u"."userName",
          "u"."breed",
          "u"."DOB",
          "u"."tagline",
          "u"."imageUrl",
          "fl"."level",
          "g"."identity"
    from "users" as "u"
    join "frenlinessLevels" as "fl" using ("levelId")
    join "genders" as "g" using ("genderId")
    where "userId" = $1
  `;

  const params = [userId];

  db.query(sql, params)
    .then(result => {
      if (result.rows.length === 0) {
        next(new ClientError(`User Id ${userId} does not exist`, 404));
      } else {
        return res.status(200).json(result.rows[0]);
      }
    })
    .catch(err => next(err));
});
// User can accept friend request

app.put('/api/fren-requests/:requestId', (req, res, next) => {
  const requestId = parseInt(req.params.requestId, 10);

  if (requestId < 0 || isNaN(requestId)) {
    throw (new ClientError(`Request Id ${req.params.requestId} is not valid`, 400));
  }

  const sql = `
    update "frenRequests"
    set "isAccepted" = true
    where "requestId" = $1
    returning *
  `;
  const params = [requestId];

  db.query(sql, params)
    .then(result => {
      if (result.rows.length === 0) {
        next(new ClientError(`Request Id ${requestId} returned no requests`, 404));
      } else {
        return res.status(200).json(result.rows[0]);
      }
    })
    .catch(err => next(err));
});

// User can request connection to other user

app.post('/api/others-profile', (req, res, next) => {
  const requestInfo = req.body;

  if (typeof requestInfo.senderId === 'undefined' ||
    typeof requestInfo.recipientId === 'undefined') {
    throw (new ClientError('Missing required information', 400));
  }

  const sql = `
    insert into "frenRequests" ("requestId", "recipientId", "senderId", "isAccepted")
    values (default, $1, $2, false)
    returning *
  `;
  const params = [parseInt(requestInfo.recipientId), parseInt(requestInfo.senderId)];

  db.query(sql, params)
    .then(result => {
      return res.status(201).json(result.rows[0]);
    })
    .catch(err => next(err));
});

// User can deny friend request

app.delete('/api/fren-requests/:requestId', (req, res, next) => {
  const requestId = parseInt(req.params.requestId, 10);

  if (requestId < 0 || isNaN(requestId)) {
    throw (new ClientError(`Request Id ${req.params.requestId} is not valid`, 400));
  }

  const sql = `
    delete from "frenRequests"
    where "requestId" = $1
  `;
  const params = [requestId];

  db.query(sql, params)
    .then(result => {
      if (result.rowCount === 0) {
        next(new ClientError(`Request Id ${requestId} does not exist`, 404));
      } else {
        return res.sendStatus(204);
      }
    })
    .catch(err => next(err));
});

// User can log in to account

app.get('/api/login', (req, res, next) => {
  db.query('select "userName", "userId" from "users"')
    .then(result => {
      res.status(200).json(result.rows);
    })
    .catch(err => next(err));
});

// User Can View All their Frens
app.get('/api/frens/:userId', (req, res, next) => {
  const userId = parseInt(req.params.userId, 10);
  const params = [userId];
  const query = `select "u"."dogName" as "name",
    "u"."imageUrl" as "image",
    "u"."location" as "location",
    "fr"."isAccepted",
    "u". "userId"
    from "frenRequests" as "fr"
    join "users" as "u" on "u"."userId" = "fr"."senderId"
    where "fr"."recipientId" = $1 and
    "fr"."isAccepted" = true;  `;
  db.query(query, params)
    .then(result => {
      if (!result) {
        return next(new ClientError('No frens yet. Let\'s find some!', 404));
      } else {
        return res.status(200).json(result.rows);
      }
    })
    .catch(err => console.error(err));
});

// User data from HomePage

app.get('/api/homepage/:userId', (req, res, next) => {
  const userId = parseInt(req.params.userId, 10);
  const sql = `SELECT  FROM "users" WHERE "userId" = ${userId}`;

  db.query(sql)
    .then(result => {
      res.status(200).json(result.rows);
    })
    .catch(err => next(err));
});

app.get('/api/users/find-frens/list/:location/:userId', (req, res, next) => {

  const userId = parseInt(req.params.userId, 10);
  const userLocation = req.params.location;
  const users = `
    select "userName",
            "imageUrl",
            "location",
            "dogName"
            from "users"
      where "location" = $1 and "userId" != $2
  `;
  const params = [userLocation, userId];
  db.query(users, params)
    .then(userInfo => {
      const totalUsers = `
    select count(*) as "numberOfUsers"
      from "users"
      where "userId" != ${userId}`;
      return db.query(totalUsers).then(total => {
        const userInt = parseInt(total.rows[0].numberOfUsers);
        if (userInt < 1) {
          res.status(404).json({
            error: 'No Doggos Nearby'
          });
          return;
        }
        const allData = userInfo.rows[0];
        allData.totalUsers = total.rows[0].numberOfUsers;
        return allData;
      });

    })
    .then(result => res.json(result))
    .catch(err => next(err));
});

app.get('/api/login', (req, res, next) => {
  db.query('select "userName", "userId" from "users"')
    .then(result => {
      res.status(200).json(result.rows);
    })
    .catch(err => next(err));
});

app.get('/api/login', (req, res, next) => {
  db.query('select "userName", "userId" from "users"')
    .then(result => {
      res.status(200).json(result.rows);
    })
    .catch(err => next(err));
});

app.get('/api/users/find-frens/list/:location/:userId', (req, res, next) => {
  const userId = parseInt(req.params.userId, 10);
  const location = req.params.location;
  const users = `
    select  "userId",
            "userName",
            "imageUrl",
            "location",
            "dogName"
            from "users"
      where "location" = $1 and "userId" != $2
  `;
  const params = [location, userId];
  db.query(users, params)
    .then(userInfo => {
      const totalUsers = `
    select count(*) as "numberOfUsers"
      from "users"
      where "userId" != ${userId}`;
      return db.query(totalUsers).then(total => {
        const userInt = parseInt(total.rows[0].numberOfUsers);
        if (userInt < 1) {
          res.status(404).json({
            error: 'No Doggos Nearby'
          });
          return;
        }
        const allData = userInfo.rows[0];
        allData.totalUsers = total.rows[0].numberOfUsers;
        return allData;
      });
    })
    .then(result => res.json(result))
    .catch(err => next(err));
});

app.use('/api', (req, res, next) => {
  next(new ClientError(`cannot ${req.method} ${req.originalUrl} `, 404));
});

app.use((err, req, res, next) => {
  if (err instanceof ClientError) {
    res.status(err.status).json({ error: err.message });
  } else {
    console.error(err);
    res.status(500).json({
      error: 'an unexpected error occurred'
    });
  }
});

app.listen(process.env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log('Listening on port', process.env.PORT);
});
