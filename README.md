# deanqx.com

My Blog and Portfolio compiled with Astro.

# Develop

Compile and Run with Docker ([http://localhost:8080/](http://localhost:8080/)):

```sh
sudo docker build -t deanqx-com .
sudo docker run -p 8080:80 deanqx-com
```

## Project Structure

Inside of your Astro project, you'll see the following folders and files:

```
├── public/
├── src/
│   ├── assets/
│   ├── components/
│   ├── content/
│   ├── layouts/
│   └── pages/
├── astro.config.mjs
├── README.md
├── package.json
└── tsconfig.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory.
Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to
put any Astro/React/Vue/Svelte/Preact components.

The `src/content/` directory contains "collections" of related Markdown and MDX
documents. Use `getCollection()` to retrieve posts from `src/content/blog/`,
and type-check your frontmatter using an optional schema.
See [Astro's Content Collections docs](https://docs.astro.build/en/guides/content-collections/)
to learn more.

Any static assets, like images, can be placed in the `public/` directory.

## Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## Staging to Production

Every push to the `main` branch triggers a package build in the format:

```
YYYYMMDD-HHmmss-GIT_SHA
20260828-104308-a2b2483
```

The `main` branch is used for public testing purposes. A few friends have access
to the private staging server where the `main` branch is hosted. They give
feedback and then a production package is released.

Production packages get a [semantic version](https://semver.org/)
clearly recognizable by the `v` at the start.

Example workflow:

```sh
git tag v0.1.0
git push --tags
```

# Extra

## Grafana Loki Traffic Analysis

All of the following examples contain a filter for local IP addresses in the
`10.x.x.x` range.

**Request log**

- Visualization: `Logs`
- Enable `Show timestamps`

```logql
{app="deanqx-com"}
|= `http.log.access.log0`
| json request_client_ip="request.client_ip", request_uri="request.uri", ts="ts"
| request_client_ip != ip(`10.0.0.0/8`)
| line_format `{{.request_client_ip}} -> {{.request_uri}}`
```

**Request count**

- Visualization: `Bar gauge`

```logql
count by () (
  count_over_time(
    {app="deanqx-com"}
    |= `http.log.access.log0`
    | json request_client_ip="request.client_ip"
    | request_client_ip != ip(`10.0.0.0/8`)
    | __error__="" [$__interval]
  )
)
```

**Most requested URIs**

- Visualization: `Bar gauge`
- Set `Orientation` to `Horizontal`

```logql
topk(10,
  sum by (request_uri) (
    count_over_time(
      {app="deanqx-com"}
      |= `http.log.access.log0`
      | json request_client_ip="request.client_ip", request_uri="request.uri"
      | request_client_ip != ip(`10.0.0.0/8`)
      [$__interval]
    )
  )
)
```
