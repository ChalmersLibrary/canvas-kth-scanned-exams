# Scanned exams

Application that downloads exams from the "Windream/AlcomREST tenta API" and uploads them into a Canvas course.


## Chalmers notes

### LADOK

In theory, everything we need is in Canvas: The Ladok Aktivitetstillfälle UUID (written in Course Section).

We need a configurable way of bypassing LADOK in the KTH code, if it's not needed.


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


### Ladok UUID and Canvas

Every section in a tentarum in Canvas has a "sis_section_id" formatted "<lastCanvasCourseNid>_<aktivitetstillfalle_uuid>_N2_<university_ending>", 
for example ```486800044154_225982d9-5f61-11eb-a0ce-c629d09c4bde_N2_SE```. The regex for getting the Ladok aktivitetstillfälle UUID needs to be changed
from what KTH has (and configurable preferably). N2 marks examination rooms, N1 is for normal course rooms.

Aldoc have "e_ladokid" that is the index that is searched, but for Chalmers this id should be "<aktivitetstillfalle_uuid>_CTH". If it's a GU
examination then "<aktivitetstillfalle_uuid>_GU". There are CTH exams in Aldoc that does not have the "_CTH" ending. We need to discuss how this is done,
it could be just old data.

There are keys in "<university_ending>" for matching UUID against "e_ladokid" in Alcom:
```_SE -> _CTH``` and ```_GUE -> _GU```.

Also, KTH code only has support for one UUID, if there are more it throws an error. At Chalmers, we can have examinations with one section CTH and one GU.
Then there are two UUID that needs to be searched in Aldoc. This needs to be addressed.

So, the UUID that needs to be searched for in Alcom index "e_ladokid" for ```486800044154_225982d9-5f61-11eb-a0ce-c629d09c4bde_N2_SE``` is ```225982d9-5f61-11eb-a0ce-c629d09c4bde_CTH```.


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

