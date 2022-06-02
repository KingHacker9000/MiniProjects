import csv


def get_data(fname):
    data = []

    with open(fname, "r", newline="\n") as f:
        reader = csv.reader(f)
        for row in reader:
            data.append(row)
    
    return data


def get_team(teamCode):
    data = get_data("jpl.csv")

    for row in data:
        if row[0] == teamCode: return True
    return False


def register(studentName, grade, section, teamCode):

    if not get_team(teamCode):
        
        with open("jpl.csv", "a", newline="\n") as f:
            writer = csv.writer(f)
            writer.writerow([teamCode, input("Enter Name of New Team:\t"), 0]) 

    with open("jplPlayers.csv", "a", newline="\n") as f:
        writer = csv.writer(f)
        writer.writerow([studentName, grade, section, teamCode])


def display_scoreboard():
    
    data = get_data("jpl.csv")
    i=0

    print("\n")   
    for row in data:
        print(row[0].center(10), row[1].center(30), row[2].center(10))
        if i==0: 
            print("="*50)
            i += 1
    print("\n")
        

def add_score(teamCode_one, teamCode_two, result):
    data = get_data("jpl.csv")

    for row in data:
        if row[0] == teamCode_one:
            if result == "0": row[2] = int(row[2]) + 1
            if result == "1": row[2] = int(row[2]) + 3

        elif row[0] == teamCode_two:
            if result == "0": row[2] = int(row[2]) + 1
            if result == "2": row[2] = int(row[2]) + 3
    
    with open("jpl.csv", "w", newline="\n") as f:
        writer = csv.writer(f)
        writer.writerows(data)
    

while True:
    print("Welcome to JSS Primiere League!")
    choice = input("What would you like to do today?\na) Register Student to Team \nb) Scoreboard \nc) Add Scores \nq) Quit Program\n->\t").strip().lower()

    if choice == "a":
        student_name = input("Enter Name of Student(Ex: Rohan Surana):\t")
        grade = input("Enter Grade of Student(Ex: 12):\t")
        section = input("Enter section of Student(Ex: A):\t")
        team_code = input("Enter Team Code(Ex: 1000):\t")

        register(student_name, grade, section, team_code)

    elif choice == "b": display_scoreboard()

    elif choice == "c":
        teamOne = input("Enter Code of team One:\t")
        teamTwo = input("Enter Code of team Two:\t")
        result = input("Enter Results of Match(0: Draw, 1: Team One Won, 2: Team Two Won):")

        if get_team(teamOne) and get_team(teamTwo): add_score(teamOne, teamTwo, result)

    else: break