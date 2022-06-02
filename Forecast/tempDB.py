import csv, random


def init_db():

    with open("UAEweather.csv", "w", newline="\n") as f:
        writer = csv.writer(f)
        writer.writerow(["Date", "Time", "Temperature"])

        for date in range(1, 31):
            for time in ["AM", "noon", "PM"]:
                temp = random.randint(28, 40)
                writer.writerow([date, time, temp])
    

def get_temp(date, time):
    
    with open("UAEweather.csv", "r", newline="\n") as f:
        reader = csv.reader(f)

        for row in reader:
            if row[0] == date and row[1] == time:
                print("Temperature:", row[2])


def display_temp():
    with open("UAEweather.csv", "r", newline="\n") as f:
        reader = csv.reader(f)
        Temp = []

        next(reader)
        for row in reader:
            Temp.append(int(row[2]))

        print("="*35)
        print("Monthly Average Temperature:", str(sum(Temp)/len(Temp))[0:4], "\n" + "="*35)
        
        day_temp = []
        day_counter = 1
        week_temp = []
        week_counter = 1

        for i in Temp:
            if len(day_temp) < 3:
                day_temp.append(i)
            else:
                print("Day", day_counter ," Average Temperature:", str(sum(day_temp)/len(day_temp))[0:4])
                day_temp.clear()
                day_counter += 1

            if len(week_temp) < 7*3:
                week_temp.append(i)
            else:
                print("-"*35)
                print("Week", week_counter ," Average Temperature:", str(sum(week_temp)/len(week_temp))[0:4])
                print("-"*35)
                week_temp.clear()
                week_counter += 1



while True:
    print("Welcome to the UAE Meteorological Department Forecasting!")
    choice = input("What would you like to do today?\na) Get Temperature \nb) Display Temperature Averages \nq) Quit Program\n->\t").strip().lower()

    if choice == "a":
        date = input("Enter Date:\t")
        time = input("Enter Time (AM/noon/PM):\t")

        get_temp(date, time)

    elif choice == "b": display_temp()

    else: break