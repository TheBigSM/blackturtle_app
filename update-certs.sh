#!/bin/bash
sudo cp /etc/letsencrypt/live/theblackturtle.duckdns.org/privkey.pem ~/Documents/blackturtle_app/certs/
sudo cp /etc/letsencrypt/live/theblackturtle.duckdns.org/fullchain.pem ~/Documents/blackturtle_app/certs/
sudo chown mateja:mateja ~/Documents/blackturtle_app/certs/*.pem
