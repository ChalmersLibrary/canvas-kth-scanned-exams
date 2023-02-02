import express from "express";
import { Issuer, generators, TokenSet } from "openid-client";
import { URL } from "url";
import log from "skog";

/**
 * Fields that are not part of the oauth standard but are included in the
 * response given by Canvas
 */
interface CanvasTokenSet extends TokenSet {
  user: {
    /** User ID */
    id: number;
  };
}

const router = express.Router();
const OAUTH_REDIRECT_URI = new URL(
  "/scanned-exams/auth/callback",
  process.env.SERVER_HOST_URL
);

const issuer = new Issuer({
  issuer: "se.chalmers",
  authorization_endpoint: new URL(
    "/login/oauth2/auth",
    process.env.CANVAS_API_URL
  ).toString(),
  token_endpoint: new URL(
    "/login/oauth2/token",
    process.env.CANVAS_API_URL
  ).toString(),
});
const client = new issuer.Client({
  client_id: process.env.CANVAS_DEVELOPER_KEY_ID,
  client_secret: process.env.CANVAS_DEVELOPER_KEY_SECRET,
  redirect_uris: [OAUTH_REDIRECT_URI.toString()],
});

router.post("/", (req, res) => {
  const state = generators.state();
  const url = client.authorizationUrl({
    state,
    scope: "url:GET|/api/v1/courses/:id",
  });

  req.session.temporalCourseId = req.body.courseId;
  req.session.temporalState = state;

  res.redirect(url);
});

router.get("/callback", async (req, res) => {
  try {
    const tokenSet = (await client.oauthCallback(
      OAUTH_REDIRECT_URI.toString(),
      req.query,
      {
        state: req.session.temporalState,
      }
    )) as CanvasTokenSet;

    // TODO: What happens if there is no "tokenSet"?
    // TODO: What happens if the user clicks "not authorize"?
    // TODO: Verify if user is "acting as"

    req.session.temporalState = undefined;
    req.session.userId = tokenSet.user.id;
    req.session.accessToken = tokenSet.access_token;
    req.session.refreshToken = tokenSet.refresh_token;

    const courseId = req.session.temporalCourseId;
    req.session.temporalCourseId = undefined;

    res.redirect(`/scanned-exams/app?courseId=${courseId}`);
  } catch (err) {
    log.error({ err });
    res
      .status(500)
      .send(
        "Unknown error when accessing /auth/callback. Please contact IT support"
      );
  }
});

export default router;
