# Scanned exams in Aldoc to Canvas

Application that downloads exams from the "Windream/AlcomREST API" and uploads them into a Canvas course Assignment. The examiner can then use
Speedgrader or download/re-upload the entries for grading each student submission.

## User documentation

[Basic user documentation for the application](docs/README.md)

## Changes

This is a fork from KTH with the following changes:

* Configurable regex when finding LADOK Aktivitetstillfälle UUID in Canvas sections
* Does not use LADOK API because the information we need is in Canvas section
* Configurable keys for matching students in Canvas
* Stores course students in time-limited cache in MongoDB for lookup, minimizing API calls
* Creates assignment with Anonymous grading if anonymous codes are found in Aldoc


## Getting started

### Generating self-signed certs with openssl

Even a development server running Docker on localhost must be started with SSL/https because of cookie issues with openid-client (state) otherwise. 
Make sure the files are accessible in ```backend/certs```.

```sh
openssl req -newkey rsa:2048 -new -nodes -keyout key.pem -out csr.pem
```
```sh
openssl x509 -req -days 365 -in csr.pem -signkey key.pem -out server.crt
```

### Configuration

There is a file ```.env.in``` which holds a number of configuration settings as environment variables. Please read trough this file and adjust as needed, then save
locally as ```.env``` for running on your machine. For production, you can use ```docker-compose.yml``` which specifies a separate ```env_file```.


### Addressing MongoDB

When addressing MongoDB on localhost from within a Docker image for scanned-exams:

```sh
MONGODB_CONNECTION_STRING=mongodb://host.docker.internal:27017/scanned-exams
```

If you are using ```docker compose``` then the server is just addressed using the service name:

```sh
MONGODB_CONNECTION_STRING=mongodb://mongo:27017/scanned-exams
```

### Using Docker

The easiest way of running this app is with Docker. There are some problems using Node 18 LTS with this code, something about certificates. Feel free to dig into this problem.
The Dockerfile specifices Node 14 for running and it works. You can use Docker Desktop on your local machine and dockerd on a Linux server, for example.

There is a file ```docker-compose-production.yml``` which you can edit and save as ```docker-compose.yml``` for running ```docker compose up``` in production. 
This starts the main app and also links and starts MongoDB which is used as a queue handler and temporary cache storage.

When running in production we just have a plain nginx as frontend server, proxying traffic to and from the Docker container on port 4443.


## Ladok UUID and Canvas Sections

For Chalmers, every section in an exam room (Canvas course) has a "sis_section_id" formatted ```<lastCanvasCourseNid>_<aktivitetstillfalle_uuid>_N2_<university_ending>```, 
for example ```486800044154_225982d9-5f61-11eb-a0ce-c629d09c4bde_N2_SE```. Aldoc have an index "e_ladokid" that is searched for the matching LADOK Aktivitetstillfälle UUID.

Sometimes there are more than one section because we have exams together with GU (Gothenburg University). If for some reason there are more than one matching section then 
there is a configuration ```CANVAS_SECTION_LADOKID_MULTIPLE_FORCE_FIRST=true``` that will only return the first one found.


## Project structure

Scanned exams is divided into 2 applications, each of them in one directory:

- `/backend`. An Express server containing the logic for the app
- `/frontend`. A React application with a small development server

This repository also contains two more projects:

- `/tentaapi-mock`. An Express server that simulates the "Tenta API". Contains information about a fake examination and instructions on how to have it in Canvas.
- `/pnummer-masker`. A project to test the "personnummer masking".


For more information, please look at [https://github.com/KTH/scanned-exams].

