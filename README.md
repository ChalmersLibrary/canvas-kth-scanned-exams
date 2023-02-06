# Scanned exams

Application that downloads exams from the "Windream/AlcomREST tenta API" and uploads them into a Canvas course.

---

## Vocabulary
These are common words and phrases that should be used in the app for UX consistency.

- KTH Import Exams? -- name of app (don't use: scanned exams?)
- Exam room -- The Canvas course where the app is installed and run. An exam room is one-to-one mapped to an aktivitetstillfälle in Ladok. (_don't_ use Course since that means something entirely different in Ladok. Don't use courseroom either, since that is something different.)
- Exam -- bla bla
- Teacher? --
- Student? --
- Missing student? --
- Windream? -- external system exams are imported from (don't use: tenta api?)
- Ladok? --
- Canvas? --
- Speed Grader? --

## Getting started

Pre-requirements

1. Install OpenSSL:
- [macOS X](https://formulae.brew.sh/formula/openssl@3#default)

2. Add a DNS override in `/etc/hosts`: 

    ```
    127.0.0.1   localdev.kth.se
    ```

3. Install npm packages

   ```sh
   (cd backend; npm i) && (cd frontend; npm i)
   ```

4. Setup env vars in backen `.env.in` to `.env`

   ```sh
   (cd backend; cp .env.in .env) && code backend/.env
   ```

5. Start backend and then frontend

   ```sh
   (cd backend; npm run dev)
   ```
   ```sh
   (cd frontend; npm run start)
   ```

---

## Project structure

Scanned exams is divided into 2 applications, each of them in one directory:

- `/backend`. An Express server containing the logic for the app
- `/frontend`. A React application with a small development server

This repository also contains two more projects:

- `/tentaapi-mock`. An Express server that simulates the "Tenta API". Contains information about a fake examination and instructions on how to have it in Canvas.
- `/pnummer-masker`. A project to test the "personnummer masking".

---


## Chalmers notes

### Generating self-signed certs with openssl

Even a development server running Docker on localhost must be started with SSL/https because of cookie issues with openid-client (state) otherwise.

```sh
openssl req -newkey rsa:2048 -new -nodes -keyout key.pem -out csr.pem
```

```sh
openssl x509 -req -days 365 -in csr.pem -signkey key.pem -out server.crt
```

When addressing MongoDB on localhost from within a Docker image for scanned-exams:

```sh
MONGODB_CONNECTION_STRING=mongodb://host.docker.internal:27017/scanned-exams
```
