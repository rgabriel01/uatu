# Image gallery app

## Basics
- This app will have a source of images currently located at ~/Desktop/_stuff/_test/_source
- The directory has image files like webp types

## The ask
- We want a gallery type image viewer
- it must have a functionality, at a press of a button, randomly rearrange the order of the images
- it must have a functionality, that when an image is clicked, there is a fixed interval in seconds that automatically scrolls the next image. This can be configured by a cog icon placed on the top right of the page. On click of said icon, it launches
  a modal that allows the interval in seconds to be configured. Have the default value to 6 seconds

### Tagging Feature
- it must have the capability to tag images.
- tags can be is as simple as a string tag that will be used to group images.
- a tag editor where users can create tags with a strict format like great-images, red-birds etc. where words are separated by hyphen. It can also detect duplicates and disallows creation if there are duplicates.
- this tag editor can be called on the cog icon, where clicking it will show a menu, initially we have the interval editor. The menu items would be Interval, Tags.
- click on Tags would open up a modal where users can manage their tags. When manage we mean add, edit and delete.
- on how we tag images, when an image is clicked, there could be an option to tag the image. An image can have multiple tags in it. A user aside from adding tags, can also remove tags as well.
- when tagging an image, the auto-scroll feature should be on hold while the user is adding in tags.

### Grouped Tag Feature
- it must have a functionality that allows the user to further filter the displayed images by tags
- a user can apply multiple tags and the list further filters by tag

### Ability to filter by images with no tags
- it must have a functionality that allows user to see all images with no tags yet
