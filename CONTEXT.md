# CleanUp Platform

CleanUp Platform manages cleaning bookings, customer portal access, staff schedules, and customer communication.

## Language

**Customer Portal**:
A customer-facing view for seeing booking status, address, included cleaning content, and contact options.
_Avoid_: dashboard, admin portal, system

**Booking**:
A specific cleaning appointment at a specific address and time.
_Avoid_: shift, schedule item, pass

**Address**:
The place where a customer receives cleaning service.
_Avoid_: object, property

**Message**:
A conversation between the customer and CleanUp about bookings, changes, additions, or questions.
_Avoid_: ticket, internal chat

**Notification**:
A user-facing signal that something needs attention or has changed.
_Avoid_: system event, log entry

**Help Case**:
A customer-facing issue or complaint connected to a booking or service quality.
_Avoid_: deviation, incident, avvikelse

**Add-on**:
Extra cleaning work requested by the customer and approved, priced, or scheduled by admin.
_Avoid_: self-service upgrade
