# smartto
뽑기 시뮬레이터

# AWS - EC2 - 인스턴스 정보
https://us-east-2.console.aws.amazon.com/ec2/home?region=us-east-2#Instances:

## 재부팅 시 public IP로 변경
sudo nano /etc/nginx/conf.d/game.conf

# pm2로 서버 시작
cd game-server

pm2 start server.js

# link
http://[public IP]:2000/
