const express = require('express')
const app = express()
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
app.use(express.json())
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const path = require('path')
const dbPath = path.join(__dirname, 'twitterClone.db')

let db = null
initializedbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('server running at http://localhost:3000')
    })
  } catch (error) {
    console.error(`Error ${error.message}`)
    process.exit(1)
  }
}
initializedbAndServer()

app.post(`/register/`, async (req, res) => {
  const {username, password, name, gender} = req.body
  const userQuery = `SELECT * from user where username=?`
  const dbUser = await db.get(userQuery, [username])
  if (dbUser !== undefined) {
    res.status(400).send('User already exists')
  } else {
    if (password.length < 6) {
      res.status(400).send('Password is too short')
      return
    }
    const hashedPassword = await bcrypt.hash(password, 10)
    const insertQuery = `INSERT INTO user (username, password, name, gender) Values
    (?,?,?,?)`
    await db.run(insertQuery, [username, hashedPassword, name, gender])
    res.status(200).send('User created successfully')
  }
})

app.post(`/login/`, async (req, res) => {
  const {username, password} = req.body
  const userQuery = `Select * from user where username=?`
  const dbUser = await db.get(userQuery, [username])
  if (dbUser === undefined) {
    res.status(400).send('Invalid user')
  } else {
    const ispasswordmatched = await bcrypt.compare(password, dbUser.password)
    if (ispasswordmatched === true) {
      const payload = {
        username: username,
      }
      const jwtToken = jwt.sign(payload, 'MY_SECRET_TOKEN')
      res.send({jwtToken})
    } else {
      res.status(400)
      res.send('Invalid Password')
    }
  }
})

const authenticateToken = (req, res, next) => {
  let jwtToken
  const authHeader = req.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    res.status(401)
    res.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'MY_SECRET_TOKEN', async (error, payload) => {
      if (error) {
        res.status(401)
        res.send('Invalid JWT Token')
      } else {
        req.user = payload

        next()
      }
    })
  }
}
app.get('/user/tweets/feed/', authenticateToken, async (req, res) => {
  const username = req.user.username
  try {
    const getuserid = `Select user_id from user where username=?`
    const {user_id: userId} = await db.get(getuserid, [username])
    const followingQuery = `
      SELECT following_user_id
      FROM follower
      WHERE follower_user_id = ?;
    `
    const followingRows = await db.all(followingQuery, [userId])
    const followingUserIds = followingRows.map(row => row.following_user_id)

    // Get the latest 4 tweets of followed users
    const tweetsQuery = `
      SELECT user.username, tweet.tweet, tweet.date_time AS dateTime
      FROM tweet
      INNER JOIN user ON tweet.user_id = user.user_id
      WHERE tweet.user_id IN (${followingUserIds.join(',')})
      ORDER BY tweet.date_time DESC
      LIMIT 4;
    `
    const tweets = await db.all(tweetsQuery)

    // Send the response
    res.status(200).json(tweets)
  } catch (error) {
    console.error(`Error: ${error.message}`)
    res.status(500).send('Internal Server Error')
  }
})

app.get(`/user/following/`, authenticateToken, async (req, res) => {
  const username = req.user.username
  const getuserid = `Select user_id from user where username=?`
  const {user_id: userId} = await db.get(getuserid, [username])
  const followingQuery = `
      SELECT user.name
      FROM follower join user on user.user_id=follower.follower_user_id
      WHERE following_user_id = ?;
    `
  const followingRows = await db.all(followingQuery, [userId])
  res.send(followingRows)
})

app.get('/tweets/:tweetId/', authenticateToken, async (req, res) => {
  const tweetId = req.params.tweetId
  const username = req.user.username
  try {
    // Get the user ID of the authenticated user
    const getUserIdQuery = `SELECT user_id FROM user WHERE username = ?`
    const {user_id: userId} = await db.get(getUserIdQuery, [username])

    // Check if the requested tweet belongs to a user the authenticated user follows
    const checkTweetQuery = `
      SELECT tweet_id 
      FROM tweet 
      WHERE tweet_id = ? AND user_id IN (
        SELECT following_user_id 
        FROM follower 
        WHERE follower_user_id = ?
      );
    `
    const tweetExists = await db.get(checkTweetQuery, [tweetId, userId])
    if (!tweetExists) {
      res.status(401).send('Invalid Request')
      return
    }
    // If the tweet belongs to a user the authenticated user follows, retrieve the tweet details
    const tweetQuery = `
      SELECT tweet.tweet, tweet.date_time AS dateTime, 
             (SELECT COUNT(*) FROM like WHERE tweet_id = ?) AS likes,
             (SELECT COUNT(*) FROM reply WHERE tweet_id = ?) AS replies,
             user.username
      FROM tweet
      INNER JOIN user ON tweet.user_id = user.user_id
      WHERE tweet.tweet_id = ?
    `
    const tweet = await db.get(tweetQuery, [tweetId, tweetId, tweetId])

    const response = {
      tweet: tweet.tweet,
      likes: tweet.likes,
      replies: tweet.replies,
      dateTime: tweet.dateTime,
    }

    res.status(200).json(response)
  } catch (error) {
    console.error(`Error: ${error.message}`)
    res.status(500).send('Internal Server Error')
  }
})

app.get('/tweets/:tweetId/likes', authenticateToken, async (req, res) => {
  const tweetId = req.params.tweetId
  const username = req.user.username
  try {
    // Get the user ID of the authenticated user
    const getUserIdQuery = `SELECT user_id FROM user WHERE username = ?`
    const {user_id: userId} = await db.get(getUserIdQuery, [username])

    // Check if the requested tweet belongs to a user the authenticated user follows
    const checkTweetQuery = `
      SELECT tweet_id 
      FROM tweet 
      WHERE tweet_id = ? AND user_id IN (
        SELECT following_user_id 
        FROM follower 
        WHERE follower_user_id = ?
      );
    `
    const tweetExists = await db.get(checkTweetQuery, [tweetId, userId])
    if (!tweetExists) {
      res.status(401).send('Invalid Request')
      return
    }
    // If the tweet belongs to a user the authenticated user follows, retrieve the tweet details
    const likesQuery = `
       SELECT user.username FROM like INNER JOIN user ON like.user_id=user.user_id
        WHERE like.tweet_id=? `
    const likes = await db.all(likesQuery, [tweetId])

    const response = {
      likes: likes.map(user => user.username),
    }

    res.status(200).json(response)
  } catch (error) {
    console.error(`Error: ${error.message}`)
    res.status(500).send('Internal Server Error')
  }
})

app.get('/tweets/:tweetId/replies', authenticateToken, async (req, res) => {
  const tweetId = req.params.tweetId
  const username = req.user.username
  try {
    // Get the user ID of the authenticated user
    const getUserIdQuery = `SELECT user_id FROM user WHERE username = ?`
    const {user_id: userId} = await db.get(getUserIdQuery, [username])

    // Check if the requested tweet belongs to a user the authenticated user follows
    const checkTweetQuery = `
      SELECT tweet_id 
      FROM tweet 
      WHERE tweet_id = ? AND user_id IN (
        SELECT following_user_id 
        FROM follower 
        WHERE follower_user_id = ?
      );
    `
    const tweetExists = await db.get(checkTweetQuery, [tweetId, userId])
    if (!tweetExists) {
      res.status(401).send('Invalid Request')
      return
    }
    // If the tweet belongs to a user the authenticated user follows, retrieve the tweet details
    const repliesQuery = `
       SELECT user.username FROM reply INNER JOIN user ON reply.user_id=user.user_id
        WHERE reply.tweet_id=? `
    const replies = await db.all(repliesQuery, [tweetId])

    const response = {
      replies: replies.map(user => user.username),
    }

    res.status(200).json(response)
  } catch (error) {
    console.error(`Error: ${error.message}`)
    res.status(500).send('Internal Server Error')
  }
})

app.get(`/user/tweets/`, authenticateToken, async (req, res) => {
  const username = req.user.username
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = ?`
  const {user_id: userId} = await db.get(getUserIdQuery, [username])

  const getusertweetsQuery = `
      SELECT tweet.tweet, tweet.date_time AS dateTime, 
             (SELECT COUNT(*) FROM like WHERE like.tweet_id = tweet.tweet_id)AS likes,
             (SELECT COUNT(*) FROM reply WHERE reply.tweet_id = tweet.tweet_id) AS replies
      FROM tweet WHERE tweet.user_id = ?
    `
  const tweets = await db.all(getusertweetsQuery, [userId])

  res.status(200).json(tweets)
})

app.post(`/user/tweets/`, authenticateToken, async (req, res) => {
  const {tweet} = req.body
  const username = req.user.username
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = ?`
  const {user_id: userId} = await db.get(getUserIdQuery, [username])

  const insertnewtweet = `INSERT INTO tweet 
  (tweet,user_id,date_time)VALUES(?,?,datetime('now'))`
  await db.run(insertnewtweet, [tweet, userId])
  res.send('Created a Tweet')
})

app.delete(`/tweets/:tweetId/`, authenticateToken, async (req, res) => {
  const tweetId = req.params.tweetId;
  const username = req.user.username
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = ?`
  const {user_id: userId} = await db.get(getUserIdQuery, [username])

  const getUserTweetIdQuery = `SELECT tweet_id FROM tweet WHERE user_id = ? AND tweet_id = ?`
  const userTweet = await db.get(getUserTweetIdQuery, [userId, tweetId])

  if (!userTweet) {
    res.status(401).send('Invalid Request')
    return
  }
  const deletetweetQuery = `DELETE FROM tweet WHERE tweet_id=?`
  await db.run(deletetweetQuery, [tweetId])
  res.send('Tweet Removed')
})

module.exports = app
