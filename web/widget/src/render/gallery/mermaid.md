## Booking a guest room

How a resident's booking travels through the College's systems:

```mermaid
sequenceDiagram
    autonumber
    actor Resident
    participant Chat as Chat assistant
    participant Desk as Front desk
    participant Rooms as Room system

    Resident->>+Chat: Is a guest room free on Friday?
    Chat->>+Rooms: Check availability (Friday)
    Rooms-->>-Chat: Room 4 and Room 7 are free
    Chat-->>Resident: Two rooms are free. Book one?
    Note over Resident,Chat: The resident chooses Room 4
    Resident->>Chat: Book Room 4
    alt Room still free
        Chat->>Desk: Hold Room 4 for the resident
        Desk-->>Chat: Held for 24 hours
        Chat-->>Resident: Booked. Pay at the desk on arrival.
    else Taken meanwhile
        Chat-->>Resident: Sorry, Room 4 has just gone.
    end
    loop Every morning
        Desk->>Desk: Release unpaid holds
    end
    Note right of Rooms: Holds expire after 24 hours
    deactivate Chat
```

## Where the questions come from

```mermaid
pie showData
    title Questions this term
    "Accommodation" : 412
    "Library" : 268
    "Events" : 187
    "Fees" : 96
    "Other" : 41
```

## Laundry use through the week

```mermaid
xychart-beta
    title "Laundry loads by day"
    x-axis [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
    y-axis "Loads" 0 --> 80
    bar [42, 38, 45, 40, 51, 72, 66]
    line [42, 38, 45, 40, 51, 72, 66]
```

## A guest room booking's states

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Requested
    Requested --> Held : room free
    Requested --> Refused : no room
    Held --> Paid : paid at the desk
    Held --> Released : unpaid after 24 hours
    state Paid {
        [*] --> CheckedIn
        CheckedIn --> CheckedOut
        CheckedOut --> [*]
    }
    Paid --> [*]
    Refused --> [*]
    Released --> [*]
```

## The booking system's classes

```mermaid
classDiagram
    class Booking {
        +String reference
        +Date arrives
        +confirm() bool
    }
    class Room {
        <<abstract>>
        +int number
        +int sleeps
    }
    Room <|-- GuestRoom
    Room <|-- FamilyRoom
    Booking "1" --> "1" Room : reserves
    Resident "1" *-- "many" Booking : makes
    Booking ..> Payment : settled by
```

## Residents, rooms and payments

```mermaid
erDiagram
    RESIDENT ||--o{ BOOKING : makes
    BOOKING }o--|| ROOM : reserves
    BOOKING ||--o| PAYMENT : "is paid by"
    RESIDENT {
        string id PK
        string name
        string house
    }
    BOOKING {
        string reference PK
        string resident FK
        date arrives
    }
```

## Term plan

```mermaid
gantt
    title Autumn term
    dateFormat YYYY-MM-DD
    section Arrival
    Welcome week        :done, w1, 2026-09-21, 7d
    Room inspections    :active, after w1, 5d
    section Teaching
    Lectures begin      :milestone, m1, 2026-10-05, 0d
    Reading week        :crit, 2026-11-02, 7d
    Exams               :2026-12-07, 2026-12-18
```

## What the College offers

```mermaid
mindmap
  root((The College))
    Rooms
      Single rooms
      Family flats
    Study
      Library
      Quiet rooms
    Community
      Events
      Societies
```

## A resident's first term

```mermaid
timeline
    title First term, week by week
    section Arriving
      Week 1 : Collect your keys : Welcome dinner
      Week 2 : Meet your house warden
    section Settling in
      Week 4 : Join a society
      Week 6 : Reading week
             : Visit the library's quiet rooms
```

## Kinds Mermaid can draw that the chat shows as code

```mermaid
gitGraph
    commit
    branch develop
    commit
    checkout main
    merge develop
```
